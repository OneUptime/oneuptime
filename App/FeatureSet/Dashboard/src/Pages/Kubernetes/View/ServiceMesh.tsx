import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Card from "Common/UI/Components/Card/Card";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
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
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";

/*
 * ──────────────────────────────────────────────────────────────────────────────
 * Query builder helper
 * ──────────────────────────────────────────────────────────────────────────────
 */

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

/*
 * ──────────────────────────────────────────────────────────────────────────────
 * Section component
 * ──────────────────────────────────────────────────────────────────────────────
 */

interface SectionProps {
  title: string;
  description: string;
  icon: IconProp;
  data: MetricViewData;
  timeRange: RangeStartAndEndDateTime;
  onTimeRangeChange: (newTimeRange: RangeStartAndEndDateTime) => void;
}

const MeshSection: FunctionComponent<SectionProps> = (
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

/*
 * ──────────────────────────────────────────────────────────────────────────────
 * Istio metric specs
 * ──────────────────────────────────────────────────────────────────────────────
 */

function getIstioTrafficQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "istio_requests_total",
        title: "Request Rate",
        description:
          "Total request throughput across all Envoy sidecars in the mesh.",
        legend: "Requests",
        legendUnit: "req/s",
        metricName: "istio_requests_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "istio_request_duration",
        title: "Request Duration",
        description:
          "Average request latency through the mesh. High values indicate service or network slowness.",
        legend: "Duration",
        legendUnit: "ms",
        metricName: "istio_request_duration_milliseconds_sum",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "istio_request_bytes",
        title: "Request Size",
        description: "Size of HTTP request bodies flowing through the mesh.",
        legend: "Size",
        legendUnit: "",
        metricName: "istio_request_bytes_sum",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "istio_response_bytes",
        title: "Response Size",
        description: "Size of HTTP response bodies flowing through the mesh.",
        legend: "Size",
        legendUnit: "",
        metricName: "istio_response_bytes_sum",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "istio_tcp_sent_bytes",
        title: "TCP Bytes Sent",
        description:
          "Total bytes sent over TCP connections in the mesh. Includes all L4 traffic.",
        legend: "Sent",
        legendUnit: "",
        metricName: "istio_tcp_sent_bytes_total",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "istio_tcp_received_bytes",
        title: "TCP Bytes Received",
        description: "Total bytes received over TCP connections in the mesh.",
        legend: "Received",
        legendUnit: "",
        metricName: "istio_tcp_received_bytes_total",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "istio_tcp_connections_opened",
        title: "TCP Connections Opened",
        description:
          "Number of new TCP connections opened. Spikes may indicate connection churn.",
        legend: "Opened",
        legendUnit: "",
        metricName: "istio_tcp_connections_opened_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "istio_tcp_connections_closed",
        title: "TCP Connections Closed",
        description:
          "Number of TCP connections closed. Compare with opened to detect leaks.",
        legend: "Closed",
        legendUnit: "",
        metricName: "istio_tcp_connections_closed_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
  ];
}

function getIstioPilotQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "pilot_xds_pushes",
        title: "xDS Config Pushes",
        description:
          "Number of xDS configuration pushes to Envoy sidecars. High rates mean frequent config changes.",
        legend: "Pushes",
        legendUnit: "",
        metricName: "pilot_xds_pushes",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "pilot_xds_push_errors",
        title: "xDS Push Errors",
        description:
          "Configuration push failures to sidecars. Non-zero values indicate connectivity or config issues.",
        legend: "Errors",
        legendUnit: "",
        metricName: "pilot_total_xds_internal_errors",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "pilot_proxy_convergence",
        title: "Proxy Convergence Time",
        description:
          "Time for configuration changes to propagate to all Envoy proxies.",
        legend: "Duration",
        legendUnit: "seconds",
        metricName: "pilot_proxy_convergence_time_sum",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "pilot_xds_connected",
        title: "Connected Proxies",
        description:
          "Number of Envoy proxies currently connected to Pilot (istiod).",
        legend: "Proxies",
        legendUnit: "",
        metricName: "pilot_xds",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "pilot_conflict_inbound",
        title: "Inbound Listener Conflicts",
        description:
          "Number of inbound listener conflicts. Indicates overlapping port configurations.",
        legend: "Conflicts",
        legendUnit: "",
        metricName: "pilot_conflict_inbound_listener",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "pilot_conflict_outbound",
        title: "Outbound Listener Conflicts",
        description: "Number of outbound listener conflicts between services.",
        legend: "Conflicts",
        legendUnit: "",
        metricName: "pilot_conflict_outbound_listener_tcp_over_current_tcp",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
  ];
}

function getEnvoyQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "envoy_cluster_upstream_cx_total",
        title: "Upstream Connections",
        description:
          "Total upstream connections initiated by Envoy proxies to backend services.",
        legend: "Connections",
        legendUnit: "",
        metricName: "envoy_cluster_upstream_cx_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "envoy_cluster_upstream_cx_active",
        title: "Active Upstream Connections",
        description:
          "Currently active upstream connections. Shows real-time connection pool utilization.",
        legend: "Active",
        legendUnit: "",
        metricName: "envoy_cluster_upstream_cx_active",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "envoy_cluster_upstream_rq_timeout",
        title: "Upstream Request Timeouts",
        description:
          "Requests that timed out waiting for an upstream response. Indicates slow or unresponsive services.",
        legend: "Timeouts",
        legendUnit: "",
        metricName: "envoy_cluster_upstream_rq_timeout",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "envoy_cluster_upstream_rq_retry",
        title: "Upstream Retries",
        description:
          "Number of request retries to upstream services. High retries indicate flaky backends.",
        legend: "Retries",
        legendUnit: "",
        metricName: "envoy_cluster_upstream_rq_retry",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "envoy_cluster_upstream_cx_connect_fail",
        title: "Connection Failures",
        description:
          "Failed upstream connection attempts. Indicates network or service availability issues.",
        legend: "Failures",
        legendUnit: "",
        metricName: "envoy_cluster_upstream_cx_connect_fail",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
  ];
}

/*
 * ──────────────────────────────────────────────────────────────────────────────
 * Linkerd metric specs
 * ──────────────────────────────────────────────────────────────────────────────
 */

function getLinkerdTrafficQueries(
  cluster: string,
): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "linkerd_request_total",
        title: "Request Rate",
        description:
          "Total request throughput across all Linkerd proxy sidecars.",
        legend: "Requests",
        legendUnit: "req/s",
        metricName: "request_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "linkerd_response_latency",
        title: "Response Latency",
        description:
          "End-to-end response latency measured at the Linkerd proxy.",
        legend: "Latency",
        legendUnit: "ms",
        metricName: "response_latency_ms_sum",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "linkerd_tcp_open_connections",
        title: "Open TCP Connections",
        description:
          "Number of currently open TCP connections managed by Linkerd proxies.",
        legend: "Connections",
        legendUnit: "",
        metricName: "tcp_open_connections",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "linkerd_tcp_read_bytes",
        title: "TCP Read Bytes",
        description:
          "Total bytes read from TCP connections by Linkerd proxies.",
        legend: "Read",
        legendUnit: "",
        metricName: "tcp_read_bytes_total",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "linkerd_tcp_write_bytes",
        title: "TCP Write Bytes",
        description:
          "Total bytes written to TCP connections by Linkerd proxies.",
        legend: "Written",
        legendUnit: "",
        metricName: "tcp_write_bytes_total",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "linkerd_tcp_open_total",
        title: "TCP Connections Opened",
        description:
          "Total TCP connections opened over time by Linkerd proxies.",
        legend: "Opened",
        legendUnit: "",
        metricName: "tcp_open_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "linkerd_tcp_close_total",
        title: "TCP Connections Closed",
        description:
          "Total TCP connections closed. Compare with opened to detect leaks.",
        legend: "Closed",
        legendUnit: "",
        metricName: "tcp_close_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
  ];
}

function getLinkerdControlPlaneQueries(
  cluster: string,
): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "linkerd_identity_certs_issued",
        title: "mTLS Certificates Issued",
        description:
          "Number of mTLS identity certificates issued by the Linkerd identity service.",
        legend: "Certificates",
        legendUnit: "",
        metricName: "identity_cert_rotation_count",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "linkerd_destination_gets",
        title: "Destination Lookups",
        description:
          "Service discovery lookups to the destination controller. Shows mesh routing activity.",
        legend: "Lookups",
        legendUnit: "",
        metricName: "destination_get_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "linkerd_proxy_injector",
        title: "Proxy Injections",
        description:
          "Number of proxy sidecar injections performed by the webhook.",
        legend: "Injections",
        legendUnit: "",
        metricName: "proxy_injector_injection_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
  ];
}

/*
 * ──────────────────────────────────────────────────────────────────────────────
 * Cilium metric specs
 * ──────────────────────────────────────────────────────────────────────────────
 */

function getCiliumDataPlaneQueries(
  cluster: string,
): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "cilium_forward_count",
        title: "Forwarded Packets",
        description:
          "Total packets forwarded by Cilium datapath (eBPF). Core throughput indicator.",
        legend: "Forwarded",
        legendUnit: "pkt/s",
        metricName: "cilium_forward_count_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cilium_forward_bytes",
        title: "Forwarded Bytes",
        description: "Total bytes forwarded through the Cilium datapath.",
        legend: "Bytes",
        legendUnit: "",
        metricName: "cilium_forward_bytes_total",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cilium_drop_count",
        title: "Dropped Packets",
        description:
          "Packets dropped by Cilium, by reason (policy denied, invalid, etc.). Non-zero needs attention.",
        legend: "Dropped",
        legendUnit: "",
        metricName: "cilium_drop_count_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cilium_drop_bytes",
        title: "Dropped Bytes",
        description: "Total bytes dropped by Cilium datapath.",
        legend: "Bytes",
        legendUnit: "",
        metricName: "cilium_drop_bytes_total",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cilium_policy_verdict",
        title: "Policy Verdicts",
        description:
          "Network policy enforcement decisions (forwarded, denied, dropped).",
        legend: "Verdicts",
        legendUnit: "",
        metricName: "cilium_policy_l4_filter_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cilium_endpoint_count",
        title: "Managed Endpoints",
        description:
          "Number of endpoints (pods) managed by Cilium on each node.",
        legend: "Endpoints",
        legendUnit: "",
        metricName: "cilium_endpoint_count",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cilium_endpoint_regenerations",
        title: "Endpoint Regenerations",
        description:
          "BPF program regenerations for endpoints. Triggered by policy or identity changes.",
        legend: "Regenerations",
        legendUnit: "",
        metricName: "cilium_endpoint_regenerations_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cilium_endpoint_regeneration_time",
        title: "Regeneration Duration",
        description:
          "Time to regenerate BPF programs. High values impact pod readiness.",
        legend: "Duration",
        legendUnit: "seconds",
        metricName: "cilium_endpoint_regeneration_time_stats_seconds_sum",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
  ];
}

function getCiliumControlPlaneQueries(
  cluster: string,
): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "cilium_identity_count",
        title: "Security Identities",
        description:
          "Number of unique security identities allocated. Each identity represents a set of labels.",
        legend: "Identities",
        legendUnit: "",
        metricName: "cilium_identity_count",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cilium_policy_count",
        title: "Policy Rules",
        description:
          "Number of network policy rules loaded into the BPF datapath.",
        legend: "Rules",
        legendUnit: "",
        metricName: "cilium_policy_count",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cilium_policy_import_errors",
        title: "Policy Import Errors",
        description:
          "Errors importing network policies. Non-zero values indicate misconfigured policies.",
        legend: "Errors",
        legendUnit: "",
        metricName: "cilium_policy_import_errors_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cilium_bpf_map_ops",
        title: "BPF Map Operations",
        description:
          "eBPF map operations (lookup, update, delete). Shows datapath activity.",
        legend: "Operations",
        legendUnit: "",
        metricName: "cilium_bpf_map_ops_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cilium_ipam_available",
        title: "Available IPs (IPAM)",
        description:
          "Number of available IP addresses in the IPAM pool. Low values may prevent pod scheduling.",
        legend: "Available",
        legendUnit: "",
        metricName: "cilium_ip_addresses",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cilium_errors_warnings",
        title: "Agent Errors",
        description:
          "Cilium agent errors and warnings. Monitors overall agent health.",
        legend: "Errors",
        legendUnit: "",
        metricName: "cilium_errors_warnings_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
  ];
}

function getCiliumHubbleQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "hubble_flows_processed",
        title: "Flows Processed",
        description:
          "Total network flows observed and processed by Hubble. Core observability throughput.",
        legend: "Flows",
        legendUnit: "flow/s",
        metricName: "hubble_flows_processed_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "hubble_tcp_flags",
        title: "TCP Flags",
        description:
          "TCP flag distribution (SYN, FIN, RST). Useful for detecting connection issues.",
        legend: "Flags",
        legendUnit: "",
        metricName: "hubble_tcp_flags_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "hubble_dns_queries",
        title: "DNS Queries Observed",
        description:
          "DNS queries observed by Hubble. Provides L7 visibility into DNS traffic.",
        legend: "Queries",
        legendUnit: "",
        metricName: "hubble_dns_queries_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "hubble_dns_responses",
        title: "DNS Responses Observed",
        description: "DNS responses observed by Hubble, by response code.",
        legend: "Responses",
        legendUnit: "",
        metricName: "hubble_dns_responses_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "hubble_drop_total",
        title: "Dropped Flows",
        description:
          "Flows dropped as observed by Hubble. Correlates with Cilium drop reasons.",
        legend: "Dropped",
        legendUnit: "",
        metricName: "hubble_drop_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
  ];
}

/*
 * ──────────────────────────────────────────────────────────────────────────────
 * Main component
 * ──────────────────────────────────────────────────────────────────────────────
 */

const KubernetesClusterServiceMesh: FunctionComponent<
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
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
    setStartAndEndDate(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange),
    );
  }, []);

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

  // Build all metric view data
  const istioTrafficData: MetricViewData = buildMetricViewData(
    getIstioTrafficQueries(clusterIdentifier),
    startAndEndDate,
  );
  const istioPilotData: MetricViewData = buildMetricViewData(
    getIstioPilotQueries(clusterIdentifier),
    startAndEndDate,
  );
  const envoyData: MetricViewData = buildMetricViewData(
    getEnvoyQueries(clusterIdentifier),
    startAndEndDate,
  );
  const linkerdTrafficData: MetricViewData = buildMetricViewData(
    getLinkerdTrafficQueries(clusterIdentifier),
    startAndEndDate,
  );
  const linkerdControlPlaneData: MetricViewData = buildMetricViewData(
    getLinkerdControlPlaneQueries(clusterIdentifier),
    startAndEndDate,
  );
  const ciliumDataPlaneData: MetricViewData = buildMetricViewData(
    getCiliumDataPlaneQueries(clusterIdentifier),
    startAndEndDate,
  );
  const ciliumControlPlaneData: MetricViewData = buildMetricViewData(
    getCiliumControlPlaneQueries(clusterIdentifier),
    startAndEndDate,
  );
  const ciliumHubbleData: MetricViewData = buildMetricViewData(
    getCiliumHubbleQueries(clusterIdentifier),
    startAndEndDate,
  );

  const tabs: Array<Tab> = [
    {
      name: "Cilium",
      children: (
        <Fragment>
          <MeshSection
            title="Data Plane — eBPF"
            description="Packet forwarding, drops, and policy enforcement at the eBPF datapath layer. Covers throughput, endpoint management, and BPF program regeneration."
            icon={IconProp.ArrowCircleRight}
            data={ciliumDataPlaneData}
            timeRange={timeRange}
            onTimeRangeChange={handleTimeRangeChange}
          />
          <MeshSection
            title="Control Plane — Agent"
            description="Cilium agent managing security identities, network policies, BPF maps, and IPAM. Monitors policy health, identity allocation, and agent errors."
            icon={IconProp.Settings}
            data={ciliumControlPlaneData}
            timeRange={timeRange}
            onTimeRangeChange={handleTimeRangeChange}
          />
          <MeshSection
            title="Hubble — Observability"
            description="Hubble network flow observability layer. Tracks flow processing throughput, DNS visibility, TCP connection flags, and dropped flows."
            icon={IconProp.Eye}
            data={ciliumHubbleData}
            timeRange={timeRange}
            onTimeRangeChange={handleTimeRangeChange}
          />
        </Fragment>
      ),
    },
    {
      name: "Istio",
      children: (
        <Fragment>
          <MeshSection
            title="Data Plane — Traffic"
            description="HTTP and TCP traffic flowing through Envoy sidecar proxies. Covers request throughput, latency, payload sizes, and connection lifecycle."
            icon={IconProp.ArrowCircleRight}
            data={istioTrafficData}
            timeRange={timeRange}
            onTimeRangeChange={handleTimeRangeChange}
          />
          <MeshSection
            title="Control Plane — Pilot (istiod)"
            description="Istio Pilot manages xDS configuration distribution to all Envoy proxies. Monitors push throughput, errors, convergence time, and listener conflicts."
            icon={IconProp.Settings}
            data={istioPilotData}
            timeRange={timeRange}
            onTimeRangeChange={handleTimeRangeChange}
          />
          <MeshSection
            title="Envoy Proxy"
            description="Low-level Envoy sidecar proxy metrics. Tracks upstream connection pools, request timeouts, retries, and connection failures."
            icon={IconProp.Globe}
            data={envoyData}
            timeRange={timeRange}
            onTimeRangeChange={handleTimeRangeChange}
          />
        </Fragment>
      ),
    },
    {
      name: "Linkerd",
      children: (
        <Fragment>
          <MeshSection
            title="Data Plane — Traffic"
            description="Request throughput, response latency, and TCP connection metrics from Linkerd proxy sidecars."
            icon={IconProp.ArrowCircleRight}
            data={linkerdTrafficData}
            timeRange={timeRange}
            onTimeRangeChange={handleTimeRangeChange}
          />
          <MeshSection
            title="Control Plane"
            description="Linkerd control plane components: identity (mTLS certificate issuance), destination (service discovery), and proxy injector (sidecar injection)."
            icon={IconProp.Settings}
            data={linkerdControlPlaneData}
            timeRange={timeRange}
            onTimeRangeChange={handleTimeRangeChange}
          />
        </Fragment>
      ),
    },
  ];

  return (
    <Fragment>
      {/* Info banner */}
      <div className="mb-5 flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <div className="flex-shrink-0 mt-0.5">
          <Icon icon={IconProp.Info} className="h-5 w-5 text-blue-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-blue-800">
            Service Mesh Metrics Configuration
          </p>
          <p className="mt-1 text-sm text-blue-600">
            Service mesh metrics require{" "}
            <code className="px-1 py-0.5 bg-blue-100 rounded text-xs font-mono">
              serviceMesh.enabled: true
            </code>{" "}
            and{" "}
            <code className="px-1 py-0.5 bg-blue-100 rounded text-xs font-mono">
              serviceMesh.provider
            </code>{" "}
            to be configured in the kubernetes-agent Helm chart values. Select
            the tab matching your provider below.
          </p>
        </div>
      </div>

      {/* Tabbed content: Cilium | Istio | Linkerd */}
      <Tabs tabs={tabs} onTabChange={() => {}} />
    </Fragment>
  );
};

export default KubernetesClusterServiceMesh;
