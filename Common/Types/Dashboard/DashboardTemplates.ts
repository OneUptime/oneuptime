import DashboardViewConfig from "./DashboardViewConfig";
import { ObjectType } from "../JSON";
import DashboardSize from "./DashboardSize";
import DashboardComponentType from "./DashboardComponentType";
import DashboardChartType from "./Chart/ChartType";
import ObjectID from "../ObjectID";
import DashboardBaseComponent from "./DashboardComponents/DashboardBaseComponent";
import DashboardVariable, { DashboardVariableType } from "./DashboardVariable";
import IconProp from "../Icon/IconProp";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import IncidentMetricType from "../Incident/IncidentMetricType";
import MonitorMetricType from "../Monitor/MonitorMetricType";
import MetricDashboardMetricType from "../Metrics/MetricDashboardMetricType";
import { DashboardValueTrendDirection } from "./DashboardComponents/DashboardValueComponent";

/*
 * Trace / Exception / Profiles entries are intentionally not in this
 * enum: their metric catalogs (e.g. SpanMetricType, ExceptionMetricType)
 * define names that are not emitted anywhere in the codebase, so the
 * templates only ever rendered empty widgets. Reach for the Logs /
 * Traces / Exceptions pages directly until those metrics exist.
 */
export enum DashboardTemplateType {
  Blank = "Blank",
  Monitor = "Monitor",
  Incident = "Incident",
  Kubernetes = "Kubernetes",
  Host = "Host",
  Proxmox = "Proxmox",
  Ceph = "Ceph",
  DockerSwarm = "DockerSwarm",
  Metrics = "Metrics",
}

export interface DashboardTemplate {
  type: DashboardTemplateType;
  name: string;
  description: string;
  icon: IconProp;
}

export const DashboardTemplates: Array<DashboardTemplate> = [
  {
    type: DashboardTemplateType.Blank,
    name: "Blank Dashboard",
    description: "Start from scratch with an empty dashboard.",
    icon: IconProp.Add,
  },
  {
    type: DashboardTemplateType.Monitor,
    name: "Monitor Dashboard",
    description:
      "Response time, uptime, status codes, CPU/memory health gauges, and breakdown table for synthetic and server monitors.",
    icon: IconProp.Heartbeat,
  },
  {
    type: DashboardTemplateType.Incident,
    name: "Incident Dashboard",
    description:
      "Incident count, MTTR/MTTA gauges, duration trends, severity breakdown, time-in-state, and longest-incident tables.",
    icon: IconProp.Alert,
  },
  {
    type: DashboardTemplateType.Kubernetes,
    name: "Kubernetes Dashboard",
    description:
      "Pod/node CPU and memory averages, utilization gauges, live pod and node lists, network I/O, restarts, and cluster logs.",
    icon: IconProp.Kubernetes,
  },
  {
    type: DashboardTemplateType.Host,
    name: "Hosts Dashboard",
    description:
      "Per-host CPU, memory, disk and network charts, a live host inventory, CPU utilization gauge, process counts, and recent logs.",
    icon: IconProp.Server,
  },
  {
    type: DashboardTemplateType.Proxmox,
    name: "Proxmox Dashboard",
    description:
      "Live node and guest inventories with status, CPU/memory trends, network throughput, and cluster logs.",
    icon: IconProp.ServerStack,
  },
  {
    type: DashboardTemplateType.Ceph,
    name: "Ceph Dashboard",
    description:
      "OSD wall and pool capacity lists, health and capacity stats, degraded-PG trends, client throughput, and cluster logs.",
    icon: IconProp.Database,
  },
  {
    type: DashboardTemplateType.DockerSwarm,
    name: "Docker Swarm Dashboard",
    description:
      "Live node and service inventories with role/status, container CPU and memory trends, PID counts, and cluster logs.",
    icon: IconProp.Cube,
  },
  {
    type: DashboardTemplateType.Metrics,
    name: "Metrics Dashboard",
    description:
      "HTTP request rate, latency, error rate, CPU utilization gauge, memory usage, disk and network I/O, and runtime metrics.",
    icon: IconProp.ChartBar,
  },
];

// -- Metric query config helpers --

interface MetricConfig {
  metricName: string;
  aggregationType: MetricsAggregationType;
  legend?: string;
  legendUnit?: string;
  /*
   * OpenTelemetry attribute keys to fan the query out across (e.g.
   * ["host.name"] for one series per host). When set, the chart renders
   * one series per unique value combination.
   */
  groupByAttributeKeys?: Array<string>;
  /*
   * Plot the per-second rate of change instead of the raw cumulative
   * counter. Required for OTel cumulative counters such as
   * `system.disk.io` and `system.network.io` so the chart shows I/O rate
   * rather than bytes-since-boot.
   */
  transformAsRate?: boolean;
}

function buildMetricQueryConfig(config: MetricConfig): Record<string, unknown> {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: undefined,
      description: undefined,
      legend: config.legend ?? undefined,
      legendUnit: config.legendUnit ?? undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: config.metricName,
        aggegationType: config.aggregationType,
      },
      groupBy: config.groupByAttributeKeys ? { attributes: true } : undefined,
      groupByAttributeKeys: config.groupByAttributeKeys,
    },
    transformAsRate: config.transformAsRate,
  };
}

function buildMetricQueryData(config: MetricConfig): Record<string, unknown> {
  return {
    metricQueryData: {
      filterData: {
        metricName: config.metricName,
        aggegationType: config.aggregationType,
      },
      groupBy: undefined,
    },
  };
}

// -- Component factory helpers --

function createTextComponent(data: {
  text: string;
  top: number;
  left: number;
  width: number;
  height: number;
  isBold?: boolean;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.Text,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 1,
    minWidthInDashboardUnits: 3,
    arguments: {
      text: data.text,
      isBold: data.isBold ?? false,
      isItalic: false,
      isUnderline: false,
      isMarkdown: false,
    },
  };
}

function createValueComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  metricConfig?: MetricConfig;
  /*
   * Per-widget override for the trend-arrow colour. Leave `undefined` to
   * let the renderer apply its metric-name heuristic (incident counts,
   * error rates, latency, CPU/memory usage flip the colour); set
   * explicitly when the heuristic would guess wrong.
   */
  trendDirection?: DashboardValueTrendDirection;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.Value,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    minWidthInDashboardUnits: 1,
    arguments: {
      title: data.title,
      metricQueryConfig: data.metricConfig
        ? buildMetricQueryData(data.metricConfig)
        : {
            metricQueryData: {
              filterData: {},
              groupBy: undefined,
            },
          },
      trendDirection: data.trendDirection,
    },
  };
}

function createChartComponent(data: {
  title: string;
  chartType: DashboardChartType;
  top: number;
  left: number;
  width: number;
  height: number;
  metricConfig?: MetricConfig;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.Chart,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 6,
    arguments: {
      chartTitle: data.title,
      chartType: data.chartType,
      metricQueryConfig: data.metricConfig
        ? buildMetricQueryConfig(data.metricConfig)
        : {
            metricAliasData: {
              metricVariable: "a",
              title: undefined,
              description: undefined,
              legend: undefined,
              legendUnit: undefined,
            },
            metricQueryData: {
              filterData: {},
              groupBy: undefined,
            },
          },
    },
  };
}

function createLogStreamComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.LogStream,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 6,
    arguments: {
      title: data.title,
      maxRows: 50,
    },
  };
}

function createGaugeComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
  minValue?: number;
  maxValue?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  metricConfig?: MetricConfig;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.Gauge,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 3,
    arguments: {
      gaugeTitle: data.title,
      minValue: data.minValue ?? 0,
      maxValue: data.maxValue ?? 100,
      warningThreshold: data.warningThreshold,
      criticalThreshold: data.criticalThreshold,
      metricQueryConfig: data.metricConfig
        ? buildMetricQueryData(data.metricConfig)
        : {
            metricQueryData: {
              filterData: {},
              groupBy: undefined,
            },
          },
    },
  };
}

function createTableComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
  maxRows?: number;
  metricConfig?: MetricConfig;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.Table,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 6,
    arguments: {
      tableTitle: data.title,
      maxRows: data.maxRows ?? 20,
      metricQueryConfig: data.metricConfig
        ? buildMetricQueryData(data.metricConfig)
        : {
            metricQueryData: {
              filterData: {},
              groupBy: undefined,
            },
          },
    },
  };
}

function createKubernetesPodListComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
  maxRows?: number;
  podPhases?: Array<string>;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.KubernetesPodList,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 4,
    arguments: {
      title: data.title,
      maxRows: data.maxRows ?? 20,
      podPhases: data.podPhases,
    },
  };
}

function createKubernetesNodeListComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
  maxRows?: number;
  readinessFilter?: string;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.KubernetesNodeList,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 4,
    arguments: {
      title: data.title,
      maxRows: data.maxRows ?? 20,
      readinessFilter: data.readinessFilter,
    },
  };
}

/*
 * Template variables are pre-built TelemetryAttribute variables that
 * ship with the template — the toolbar renders a "Cluster" /
 * "Namespace" / "Host" picker without the user having to open the
 * Variables modal. Resource attributes from the OTel collector are
 * stored in ClickHouse under the `resource.` prefix (see the comment
 * in MonitorAlert.ts), so the binding keys here mirror what the
 * Kubernetes / Host detail pages already filter on.
 */
function createTelemetryAttributeVariable(data: {
  name: string;
  label: string;
  attributeKey: string;
  isMultiSelect?: boolean;
}): DashboardVariable {
  return {
    id: ObjectID.generate().toString(),
    name: data.name,
    label: data.label,
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: data.attributeKey,
    isMultiSelect: data.isMultiSelect ?? false,
  };
}

function createHostListComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
  maxRows?: number;
  statusFilter?: string;
  osTypeFilter?: string;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.HostList,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 6,
    arguments: {
      title: data.title,
      maxRows: data.maxRows ?? 25,
      statusFilter: data.statusFilter,
      osTypeFilter: data.osTypeFilter,
    },
  };
}

function createProxmoxNodeListComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
  maxRows?: number;
  statusFilter?: string;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.ProxmoxNodeList,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 4,
    arguments: {
      title: data.title,
      maxRows: data.maxRows ?? 20,
      statusFilter: data.statusFilter,
    },
  };
}

function createProxmoxGuestListComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
  maxRows?: number;
  guestTypeFilter?: string;
  statusFilter?: string;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.ProxmoxGuestList,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 4,
    arguments: {
      title: data.title,
      maxRows: data.maxRows ?? 20,
      guestTypeFilter: data.guestTypeFilter,
      statusFilter: data.statusFilter,
    },
  };
}

function createDockerSwarmNodeListComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
  maxRows?: number;
  roleFilter?: string;
  statusFilter?: string;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.DockerSwarmNodeList,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 4,
    arguments: {
      title: data.title,
      maxRows: data.maxRows ?? 20,
      roleFilter: data.roleFilter,
      statusFilter: data.statusFilter,
    },
  };
}

function createDockerSwarmServiceListComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
  maxRows?: number;
  serviceModeFilter?: string;
  statusFilter?: string;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.DockerSwarmServiceList,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 4,
    arguments: {
      title: data.title,
      maxRows: data.maxRows ?? 20,
      serviceModeFilter: data.serviceModeFilter,
      statusFilter: data.statusFilter,
    },
  };
}

function createCephOsdListComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
  maxRows?: number;
  viewMode?: string;
  stateFilter?: string;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.CephOsdList,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 4,
    arguments: {
      title: data.title,
      maxRows: data.maxRows ?? 50,
      // The OSD wall — honeycomb is the view operators expect.
      viewMode: data.viewMode ?? "honeycomb",
      stateFilter: data.stateFilter,
    },
  };
}

function createCephPoolListComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
  maxRows?: number;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.CephPoolList,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 4,
    arguments: {
      title: data.title,
      maxRows: data.maxRows ?? 20,
    },
  };
}

// -- Dashboard configs --

function createMonitorDashboardConfig(): DashboardViewConfig {
  const components: Array<DashboardBaseComponent> = [
    // Row 0: Title
    createTextComponent({
      text: "Monitor Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 1: Key metric values
    createValueComponent({
      title: "Response Time",
      top: 1,
      left: 0,
      width: 3,
      metricConfig: {
        metricName: MonitorMetricType.ResponseTime,
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "ms",
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    /*
     * IsOnline is emitted as 0/1 with unit "" by MonitorMetricUtil, so
     * `Avg` gives the uptime ratio in [0, 1] rather than a percent. We
     * label the widget "Uptime (avg)" instead of "%" so the fractional
     * display isn't misleading; flipping the storage to 0/100 + unit
     * "%" would change criteria evaluation elsewhere in the codebase.
     */
    createValueComponent({
      title: "Uptime (avg)",
      top: 1,
      left: 3,
      width: 3,
      metricConfig: {
        metricName: MonitorMetricType.IsOnline,
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsBetter,
    }),
    /*
     * ResponseStatusCode is the literal HTTP status code (200, 404,
     * 503, …). `Count` over it returns the total number of checks the
     * monitor ran, not the error rate — the original "Error Rate" label
     * was misleading. Filtering to status >= 400 would require attribute
     * filters that the template helper doesn't expose, so we relabel.
     */
    createValueComponent({
      title: "Total Checks",
      top: 1,
      left: 6,
      width: 3,
      metricConfig: {
        metricName: MonitorMetricType.ResponseStatusCode,
        aggregationType: MetricsAggregationType.Count,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsBetter,
    }),
    createValueComponent({
      title: "Execution Time",
      top: 1,
      left: 9,
      width: 3,
      metricConfig: {
        metricName: MonitorMetricType.ExecutionTime,
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "ms",
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),

    // Row 2-4: Charts
    createChartComponent({
      title: "Response Time Over Time",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MonitorMetricType.ResponseTime,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Avg Response Time",
        legendUnit: "ms",
      },
    }),
    createChartComponent({
      title: "Uptime Over Time",
      chartType: DashboardChartType.Area,
      top: 2,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MonitorMetricType.IsOnline,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Uptime Ratio",
      },
    }),

    // Row 5: Section header
    createTextComponent({
      text: "Health & Errors",
      top: 5,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 6-8: Gauges and error chart
    createGaugeComponent({
      title: "CPU Usage",
      top: 6,
      left: 0,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 100,
      warningThreshold: 70,
      criticalThreshold: 90,
      metricConfig: {
        metricName: MonitorMetricType.CPUUsagePercent,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),
    createGaugeComponent({
      title: "Memory Usage",
      top: 6,
      left: 3,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 100,
      warningThreshold: 70,
      criticalThreshold: 90,
      metricConfig: {
        metricName: MonitorMetricType.MemoryUsagePercent,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),
    createChartComponent({
      title: "Status Code Over Time",
      chartType: DashboardChartType.Bar,
      top: 6,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MonitorMetricType.ResponseStatusCode,
        aggregationType: MetricsAggregationType.Count,
        legend: "Status Codes",
      },
    }),

    // Row 9: Section header
    createTextComponent({
      text: "Details",
      top: 9,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 10-12: Table and logs
    createTableComponent({
      title: "Response Time Breakdown",
      top: 10,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MonitorMetricType.ResponseTime,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),
    createLogStreamComponent({
      title: "Recent Logs",
      top: 10,
      left: 6,
      width: 6,
      height: 3,
    }),
  ];

  /*
   * Monitor metrics are stored with bare attribute keys (`monitorName`,
   * `probeName`) rather than the OTel `resource.*` prefix — see
   * MonitorMetricUtil.buildAttributes — so the variable binds to the
   * bare key. Multi-select lets users pin a small group of monitors.
   */
  const variables: Array<DashboardVariable> = [
    createTelemetryAttributeVariable({
      name: "monitor",
      label: "Monitor",
      attributeKey: "monitorName",
      isMultiSelect: true,
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    variables,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 13),
  };
}

function createIncidentDashboardConfig(): DashboardViewConfig {
  /*
   * Incident metrics (TimeToResolve, TimeToAcknowledge, IncidentDuration,
   * TimeInState, PostmortemCompletionTime) are emitted with unit
   * "seconds" by IncidentService. Templates previously passed
   * `legendUnit: "min"` to relabel the chart legend, but that bypassed
   * ValueFormatter's scale-aware formatting and rendered raw seconds
   * with a "Minutes" suffix (e.g. a 1-hour incident showed as
   * "3600 Minutes"). Gauges were authored against an implicit minute
   * scale (maxValue 120, threshold 60/90) and compared bytes-of-seconds
   * against minutes, so any incident over ~2 minutes pinned the gauge.
   *
   * We now drop the legendUnit overrides — ValueFormatter scales
   * `seconds` to sec/min/hr/days based on magnitude — and reauthor the
   * gauge ranges in seconds so the 0-100% sweep is meaningful.
   */
  const components: Array<DashboardBaseComponent> = [
    // Row 0: Title
    createTextComponent({
      text: "Incident Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 1: Key incident metrics — every one is "higher = worse".
    createValueComponent({
      title: "Incident Count",
      top: 1,
      left: 0,
      width: 3,
      metricConfig: {
        metricName: IncidentMetricType.IncidentCount,
        aggregationType: MetricsAggregationType.Sum,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createValueComponent({
      title: "MTTR",
      top: 1,
      left: 3,
      width: 3,
      metricConfig: {
        metricName: IncidentMetricType.TimeToResolve,
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createValueComponent({
      title: "MTTA",
      top: 1,
      left: 6,
      width: 3,
      metricConfig: {
        metricName: IncidentMetricType.TimeToAcknowledge,
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createValueComponent({
      title: "Avg Duration",
      top: 1,
      left: 9,
      width: 3,
      metricConfig: {
        metricName: IncidentMetricType.IncidentDuration,
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),

    // Row 2-4: Incident trends
    createChartComponent({
      title: "Incidents Over Time",
      chartType: DashboardChartType.Bar,
      top: 2,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: IncidentMetricType.IncidentCount,
        aggregationType: MetricsAggregationType.Sum,
        legend: "Incidents",
      },
    }),
    createChartComponent({
      title: "Incident Duration Over Time",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: IncidentMetricType.IncidentDuration,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Avg Duration",
      },
    }),

    // Row 5: Section header
    createTextComponent({
      text: "Response Performance",
      top: 5,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    /*
     * Row 6-8: MTTR/MTTA gauges. Ranges and thresholds are now in
     * seconds (matching the stored metric unit). Targets: MTTR full
     * scale 2 hours (warn at 1 hour, critical at 1.5 hours); MTTA full
     * scale 1 hour (warn at 15 min, critical at 30 min).
     */
    createGaugeComponent({
      title: "MTTR",
      top: 6,
      left: 0,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 7200,
      warningThreshold: 3600,
      criticalThreshold: 5400,
      metricConfig: {
        metricName: IncidentMetricType.TimeToResolve,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),
    createGaugeComponent({
      title: "MTTA",
      top: 6,
      left: 3,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 3600,
      warningThreshold: 900,
      criticalThreshold: 1800,
      metricConfig: {
        metricName: IncidentMetricType.TimeToAcknowledge,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),
    createChartComponent({
      title: "MTTR and MTTA Over Time",
      chartType: DashboardChartType.Area,
      top: 6,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: IncidentMetricType.TimeToResolve,
        aggregationType: MetricsAggregationType.Avg,
        legend: "MTTR",
      },
    }),

    // Row 9: Section header
    createTextComponent({
      text: "Breakdown & Analysis",
      top: 9,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 10-12: Severity breakdown and time in state
    createChartComponent({
      title: "Severity Changes Over Time",
      chartType: DashboardChartType.Pie,
      top: 10,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: IncidentMetricType.SeverityChange,
        aggregationType: MetricsAggregationType.Count,
        legend: "Severity Changes",
      },
    }),
    createChartComponent({
      title: "Time in State",
      chartType: DashboardChartType.StackedArea,
      top: 10,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: IncidentMetricType.TimeInState,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Time in State",
      },
    }),

    // Row 13: Section header
    createTextComponent({
      text: "Incident Details",
      top: 13,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    /*
     * Row 14-16: Operational tables. Logs / traces were removed from the
     * Incident template because incident records are not log/trace
     * sources — they're rows in Postgres. Surfacing unrelated cluster
     * logs and trace lists alongside MTTR/MTTA was a UX miss; if a user
     * wants those views they live on dedicated Trace / Log pages.
     */
    createTableComponent({
      title: "Incidents by Duration",
      top: 14,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: IncidentMetricType.IncidentDuration,
        aggregationType: MetricsAggregationType.Max,
      },
    }),
    createTableComponent({
      title: "Postmortem Completion Time",
      top: 14,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: IncidentMetricType.PostmortemCompletionTime,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 17),
  };
}

function createKubernetesDashboardConfig(): DashboardViewConfig {
  /*
   * Layout notes:
   *
   * - "Pod Count" / "Node Ready" used to be Value widgets over k8s.pod.phase
   *   / k8s.node.condition_ready with `Sum` aggregation. Those metrics are
   *   per-resource gauges that re-emit `1` on every scrape, so summing
   *   across the dashboard window multiplied (pods * scrapes) and produced
   *   numbers in the hundreds for tiny clusters. The user-visible fix is
   *   to use the dedicated KubernetesPodList / KubernetesNodeList widgets
   *   below — they read the per-cluster snapshot in Postgres and show
   *   accurate counts in the widget header plus a live list of rows.
   *
   * - "Memory Utilization" used to be a 0-100 gauge over k8s.node.memory.usage,
   *   which is reported in bytes. A node with 8 GB of RAM produced a value
   *   in the 10^9 range against a 0-100 scale, so the gauge always pinned
   *   at the critical end with a meaningless absolute number. Without a
   *   first-class percent metric we replace it with a Value widget that
   *   renders the absolute usage via ValueFormatter (e.g. "8.3 GB").
   *
   * - CPU widgets show cores, not a percent. OTel's k8s.*.cpu.utilization
   *   is a misnamed cores gauge (cores in use, NOT a [0, 1] ratio), and
   *   this templated dashboard's renderer can't divide by per-node
   *   allocatable CPU to form a true percentage. So we use the `.usage`
   *   metrics and label them in cores ("2.3 cores"). The Kubernetes
   *   cluster overview page — which fetches `k8s.node.allocatable_cpu` —
   *   is where CPU is shown as a real "% of capacity".
   */
  const components: Array<DashboardBaseComponent> = [
    // Row 0: Title
    createTextComponent({
      text: "Kubernetes Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    /*
     * Row 1: Key cluster metrics — averages render with proper units via
     * ValueFormatter (CPU usage → cores, memory.usage → "MB"/"GB").
     * All four are "higher = worse" (closer to capacity = bad).
     */
    createValueComponent({
      title: "Pod CPU (cores, avg)",
      top: 1,
      left: 0,
      width: 3,
      metricConfig: {
        metricName: "k8s.pod.cpu.usage",
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createValueComponent({
      title: "Pod Memory (avg)",
      top: 1,
      left: 3,
      width: 3,
      metricConfig: {
        metricName: "k8s.pod.memory.usage",
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createValueComponent({
      title: "Node CPU (cores, avg)",
      top: 1,
      left: 6,
      width: 3,
      metricConfig: {
        metricName: "k8s.node.cpu.usage",
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createValueComponent({
      title: "Node Memory (avg)",
      top: 1,
      left: 9,
      width: 3,
      metricConfig: {
        metricName: "k8s.node.memory.usage",
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),

    // Row 2-4: Resource usage charts
    createChartComponent({
      title: "Pod CPU Cores Over Time",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "k8s.pod.cpu.usage",
        aggregationType: MetricsAggregationType.Avg,
        legend: "CPU Cores",
      },
    }),
    createChartComponent({
      title: "Memory Usage Over Time",
      chartType: DashboardChartType.Area,
      top: 2,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "k8s.pod.memory.usage",
        aggregationType: MetricsAggregationType.Avg,
        legend: "Memory Usage",
      },
    }),

    // Row 5: Section header
    createTextComponent({
      text: "Cluster Resources",
      top: 5,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    /*
     * Row 6-9: Pod and node lists query the Postgres snapshot, so the
     * header shows the true current count and the body shows live rows
     * (replacing the broken Sum-of-gauge Value widgets).
     */
    createKubernetesPodListComponent({
      title: "Pods",
      top: 6,
      left: 0,
      width: 6,
      height: 4,
      maxRows: 25,
    }),
    createKubernetesNodeListComponent({
      title: "Nodes",
      top: 6,
      left: 6,
      width: 6,
      height: 4,
      maxRows: 25,
    }),

    // Row 10: Section header
    createTextComponent({
      text: "Resource Health",
      top: 10,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    /*
     * Row 11-13: cluster CPU cores tile and the network throughput
     * chart. This was a 0-100 CPU gauge, but the cores-valued
     * `k8s.node.cpu.utilization` pinned it to nonsense (e.g. 711%) and
     * the templated renderer can't divide by allocatable CPU to make a
     * real percentage — so we show total cores in use instead. The old
     * "Memory Utilization" gauge over raw bytes is gone — see
     * top-of-function comment.
     */
    createValueComponent({
      title: "Cluster CPU (cores in use)",
      top: 11,
      left: 0,
      width: 4,
      metricConfig: {
        metricName: "k8s.node.cpu.usage",
        aggregationType: MetricsAggregationType.Sum,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createChartComponent({
      title: "Network I/O",
      chartType: DashboardChartType.Area,
      top: 11,
      left: 4,
      width: 8,
      height: 3,
      metricConfig: {
        metricName: "k8s.pod.network.io",
        aggregationType: MetricsAggregationType.Sum,
        legend: "Network I/O",
      },
    }),

    // Row 14: Section header
    createTextComponent({
      text: "Workload Activity",
      top: 14,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 15-17: Restarts and replicas
    createChartComponent({
      title: "Container Restarts Over Time",
      chartType: DashboardChartType.Bar,
      top: 15,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "k8s.container.restarts",
        aggregationType: MetricsAggregationType.Max,
        legend: "Restarts",
      },
    }),
    createTableComponent({
      title: "Deployment Replicas",
      top: 15,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "k8s.deployment.available_replicas",
        aggregationType: MetricsAggregationType.Min,
      },
    }),

    // Row 18-20: Logs
    createLogStreamComponent({
      title: "Cluster Logs",
      top: 18,
      left: 0,
      width: 12,
      height: 3,
    }),
  ];

  /*
   * Pre-built variables let the user scope every widget on the dashboard
   * to a single cluster / namespace from the toolbar. Multi-select is on
   * for namespace so users can pick a couple of namespaces at once;
   * cluster stays single-select since the typical "compare two clusters"
   * workflow lives on the Compare page.
   */
  const variables: Array<DashboardVariable> = [
    createTelemetryAttributeVariable({
      name: "cluster",
      label: "Cluster",
      attributeKey: "resource.k8s.cluster.name",
    }),
    createTelemetryAttributeVariable({
      name: "namespace",
      label: "Namespace",
      attributeKey: "resource.k8s.namespace.name",
      isMultiSelect: true,
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    variables,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 21),
  };
}

function createMetricsDashboardConfig(): DashboardViewConfig {
  /*
   * Layout notes:
   *
   * - `system.cpu.utilization` and `process.cpu.utilization` are OTel
   *   ratio metrics with unit "1" reported in [0, 1]. DashboardValueComponent
   *   / DashboardGaugeComponent scale these to a percent at render time
   *   (see splitFormattedValue / isFractionScale), so the 0-100 gauge sweep
   *   and the percent display work without any special template config.
   *
   * - `system.memory.usage` is reported in bytes. A previous "Memory Usage"
   *   gauge compared bytes (10⁹ range) against a 0-100 sweep and pinned
   *   critical for any sane workload. We swapped it for a Value widget that
   *   renders the absolute usage via ValueFormatter (e.g. "8.3 GB"), since
   *   there is no first-class memory-utilization percent metric in OTel's
   *   default system instrumentation.
   *
   * - We also dropped explicit `legendUnit: "bytes"/"%"/"ms"` overrides
   *   where they duplicated the stored MetricType unit — ValueFormatter
   *   already auto-scales bytes/seconds/ms and renders ratio metrics as
   *   percent. Keeping overrides only when they add useful aliasing.
   */
  const components: Array<DashboardBaseComponent> = [
    // Row 0: Title
    createTextComponent({
      text: "Metrics Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    /*
     * Row 1: Key HTTP metrics. Request volume rising is generally a
     * sign of activity (good); latency, errors, and active in-flight
     * requests rising signal saturation or trouble (bad).
     */
    createValueComponent({
      title: "Request Rate",
      top: 1,
      left: 0,
      width: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.HttpRequestCount,
        aggregationType: MetricsAggregationType.Sum,
        legendUnit: "req/s",
      },
      trendDirection: DashboardValueTrendDirection.HigherIsBetter,
    }),
    createValueComponent({
      title: "Avg Latency",
      top: 1,
      left: 3,
      width: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.HttpRequestDuration,
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "ms",
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createValueComponent({
      title: "Error Rate",
      top: 1,
      left: 6,
      width: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.HttpRequestErrorRate,
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "%",
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createValueComponent({
      title: "Active Requests",
      top: 1,
      left: 9,
      width: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.HttpActiveRequests,
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),

    // Row 2-4: HTTP request charts
    createChartComponent({
      title: "Request Rate Over Time",
      chartType: DashboardChartType.Bar,
      top: 2,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.HttpRequestCount,
        aggregationType: MetricsAggregationType.Sum,
        legend: "Requests",
        legendUnit: "req/s",
      },
    }),
    createChartComponent({
      title: "Request Latency Over Time",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.HttpRequestDuration,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Avg Latency",
        legendUnit: "ms",
      },
    }),

    // Row 5: Section header
    createTextComponent({
      text: "Error Analysis",
      top: 5,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 6-8: Error charts and response sizes
    createChartComponent({
      title: "Error Rate Over Time",
      chartType: DashboardChartType.Area,
      top: 6,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.HttpRequestErrorRate,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Error Rate",
        legendUnit: "%",
      },
    }),
    createChartComponent({
      title: "Response Size Over Time",
      chartType: DashboardChartType.Line,
      top: 6,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.HttpResponseSize,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Response Size",
        legendUnit: "bytes",
      },
    }),

    // Row 9: Section header
    createTextComponent({
      text: "System Resources",
      top: 9,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    /*
     * Row 10-12: System resource health. CPU has a percent gauge (auto-
     * scaled from [0, 1] ratio at render time); Memory has a Value widget
     * since `system.memory.usage` is bytes (auto-formatted to MB/GB) and
     * we don't have a first-class memory-utilization percent metric.
     */
    createGaugeComponent({
      title: "CPU Utilization",
      top: 10,
      left: 0,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 100,
      warningThreshold: 70,
      criticalThreshold: 90,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemCpuUtilization,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),
    createValueComponent({
      title: "Memory Usage",
      top: 10,
      left: 3,
      width: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemMemoryUsage,
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createChartComponent({
      title: "CPU Usage Over Time",
      chartType: DashboardChartType.Area,
      top: 10,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemCpuUtilization,
        aggregationType: MetricsAggregationType.Avg,
        legend: "CPU",
      },
    }),

    // Row 13: Section header
    createTextComponent({
      text: "I/O & Network",
      top: 13,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 14-16: Disk and network I/O
    createChartComponent({
      title: "Disk I/O Over Time",
      chartType: DashboardChartType.StackedArea,
      top: 14,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemDiskIo,
        aggregationType: MetricsAggregationType.Sum,
        legend: "Disk I/O",
        legendUnit: "bytes",
      },
    }),
    createChartComponent({
      title: "Network I/O Over Time",
      chartType: DashboardChartType.StackedArea,
      top: 14,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemNetworkIo,
        aggregationType: MetricsAggregationType.Sum,
        legend: "Network I/O",
        legendUnit: "bytes",
      },
    }),

    // Row 17: Section header
    createTextComponent({
      text: "Runtime & Application",
      top: 17,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 18-20: Runtime metrics
    createChartComponent({
      title: "Process CPU Over Time",
      chartType: DashboardChartType.Line,
      top: 18,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.ProcessCpuUtilization,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Process CPU",
        legendUnit: "%",
      },
    }),
    createChartComponent({
      title: "GC Duration Over Time",
      chartType: DashboardChartType.Bar,
      top: 18,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.GcDuration,
        aggregationType: MetricsAggregationType.Avg,
        legend: "GC Duration",
        legendUnit: "ms",
      },
    }),

    // Row 21-23: Table and logs
    createTableComponent({
      title: "Top Metrics by Value",
      top: 21,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.HttpRequestDuration,
        aggregationType: MetricsAggregationType.Max,
      },
    }),
    createLogStreamComponent({
      title: "Recent Logs",
      top: 21,
      left: 6,
      width: 6,
      height: 3,
    }),
  ];

  /*
   * Most HTTP / runtime metrics on this dashboard carry the standard
   * OTel `resource.service.name` attribute, so scoping by service is
   * the most useful default. Multi-select keeps the cross-service view
   * available — e.g. compare API and worker on one chart.
   */
  const variables: Array<DashboardVariable> = [
    createTelemetryAttributeVariable({
      name: "service",
      label: "Service",
      attributeKey: "resource.service.name",
      isMultiSelect: true,
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    variables,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 24),
  };
}

function createHostDashboardConfig(): DashboardViewConfig {
  /*
   * Layout notes:
   *
   * - Per-host charts fan out via `groupByAttributeKeys: ["host.name"]`
   *   so a single chart renders one series per host. The OTel host
   *   receiver emits `system.cpu.utilization` as a [0, 1] ratio, which
   *   Value/Gauge widgets auto-scale to percent at render time (see
   *   splitFormattedValue / isFractionScale).
   *
   * - The Value widget for "Avg Memory" uses `system.memory.usage`
   *   (bytes) and is auto-formatted to MB/GB by ValueFormatter, since
   *   `system.memory.utilization` is not always emitted by default OTel
   *   host metrics.
   *
   * - Disk and Network I/O charts set `transformAsRate: true` so the
   *   cumulative byte counters render as per-second rates rather than
   *   bytes-since-boot. The matching Value tiles in row 1 keep the
   *   unrated Sum so users see an absolute byte figure over the window.
   */
  const components: Array<DashboardBaseComponent> = [
    // Row 0: Title
    createTextComponent({
      text: "Hosts Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 1: Key host metrics
    createValueComponent({
      title: "Avg CPU",
      top: 1,
      left: 0,
      width: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemCpuUtilization,
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createValueComponent({
      title: "Avg Memory",
      top: 1,
      left: 3,
      width: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemMemoryUsage,
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createValueComponent({
      title: "Disk I/O",
      top: 1,
      left: 6,
      width: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemDiskIo,
        aggregationType: MetricsAggregationType.Sum,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsBetter,
    }),
    createValueComponent({
      title: "Network I/O",
      top: 1,
      left: 9,
      width: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemNetworkIo,
        aggregationType: MetricsAggregationType.Sum,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsBetter,
    }),

    // Row 2-4: Per-host CPU and Memory charts
    createChartComponent({
      title: "CPU Utilization by Host",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemCpuUtilization,
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKeys: ["host.name"],
      },
    }),
    createChartComponent({
      title: "Memory Usage by Host",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemMemoryUsage,
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKeys: ["host.name"],
      },
    }),

    // Row 5: Section header
    createTextComponent({
      text: "Hosts",
      top: 5,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    /*
     * Row 6-9: Live host inventory. The widget reads the Postgres host
     * snapshot, so the header shows the true current count and rows
     * link to per-host detail pages.
     */
    createHostListComponent({
      title: "All Hosts",
      top: 6,
      left: 0,
      width: 12,
      height: 4,
      maxRows: 25,
    }),

    // Row 10: Section header
    createTextComponent({
      text: "Resource Health",
      top: 10,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    /*
     * Row 11-13: CPU gauge (auto-scaled from [0,1] ratio to percent),
     * alongside the filesystem-usage chart so capacity pressure is
     * visible per host.
     */
    createGaugeComponent({
      title: "Avg CPU Utilization",
      top: 11,
      left: 0,
      width: 4,
      height: 3,
      minValue: 0,
      maxValue: 100,
      warningThreshold: 70,
      criticalThreshold: 90,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemCpuUtilization,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),
    createChartComponent({
      title: "Filesystem Usage by Host",
      chartType: DashboardChartType.Line,
      top: 11,
      left: 4,
      width: 8,
      height: 3,
      metricConfig: {
        metricName: "system.filesystem.usage",
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKeys: ["host.name"],
      },
    }),

    // Row 14: Section header
    createTextComponent({
      text: "I/O Activity",
      top: 14,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 15-17: Disk and network I/O rates per host
    createChartComponent({
      title: "Disk I/O by Host",
      chartType: DashboardChartType.Line,
      top: 15,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemDiskIo,
        aggregationType: MetricsAggregationType.Sum,
        groupByAttributeKeys: ["host.name"],
        transformAsRate: true,
      },
    }),
    createChartComponent({
      title: "Network I/O by Host",
      chartType: DashboardChartType.Line,
      top: 15,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: MetricDashboardMetricType.SystemNetworkIo,
        aggregationType: MetricsAggregationType.Sum,
        groupByAttributeKeys: ["host.name"],
        transformAsRate: true,
      },
    }),

    // Row 18: Section header
    createTextComponent({
      text: "Processes & Logs",
      top: 18,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 19-21: Process count chart and recent logs
    createChartComponent({
      title: "Process Count by Host",
      chartType: DashboardChartType.Line,
      top: 19,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "system.processes.count",
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKeys: ["host.name"],
      },
    }),
    createLogStreamComponent({
      title: "Recent Logs",
      top: 19,
      left: 6,
      width: 6,
      height: 3,
    }),
  ];

  /*
   * Per-host scoping: the variable defaults to multi-select because the
   * dashboard's by-host charts already split rendering per host; the
   * selector lets users narrow to a subset (e.g. just two prod hosts)
   * without losing the per-host breakdown.
   */
  const variables: Array<DashboardVariable> = [
    createTelemetryAttributeVariable({
      name: "host",
      label: "Host",
      attributeKey: "resource.host.name",
      isMultiSelect: true,
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    variables,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 22),
  };
}

function createProxmoxDashboardConfig(): DashboardViewConfig {
  /*
   * Layout notes:
   *
   * - Node / guest counts come from the Postgres inventory list widgets,
   *   never from Sum-of-gauge Value widgets — pve_up re-emits 1 on every
   *   scrape, so summing it across the dashboard window multiplies
   *   (resources x scrapes), the exact failure the Kubernetes template
   *   documents. The list-widget headers show the true current counts.
   *
   * - Template metric widgets cannot filter on datapoint attributes, so
   *   the CPU / memory charts average across every PVE object that
   *   reports the metric (nodes AND guests — pve-exporter emits
   *   pve_cpu_usage_ratio / pve_memory_usage_bytes for both scopes).
   *   That is a useful temperature signal for a wall dashboard; the
   *   per-scope, capacity-weighted versions live on the cluster
   *   Overview page.
   *
   * - pve_network_*_bytes are cumulative counters, so the throughput
   *   charts use transformAsRate.
   */
  const components: Array<DashboardBaseComponent> = [
    // Row 0: Title
    createTextComponent({
      text: "Proxmox Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Rows 1-4: Live inventory from the Postgres snapshot
    createProxmoxNodeListComponent({
      title: "Nodes",
      top: 1,
      left: 0,
      width: 6,
      height: 4,
      maxRows: 25,
    }),
    createProxmoxGuestListComponent({
      title: "Guests",
      top: 1,
      left: 6,
      width: 6,
      height: 4,
      maxRows: 25,
    }),

    // Row 5: Section header
    createTextComponent({
      text: "Resource Usage",
      top: 5,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Rows 6-8: CPU and memory trends
    createChartComponent({
      title: "CPU Usage Ratio (avg across nodes & guests)",
      chartType: DashboardChartType.Line,
      top: 6,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "pve_cpu_usage_ratio",
        aggregationType: MetricsAggregationType.Avg,
        legend: "CPU ratio",
      },
    }),
    createChartComponent({
      title: "Memory Usage (avg across nodes & guests)",
      chartType: DashboardChartType.Area,
      top: 6,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "pve_memory_usage_bytes",
        aggregationType: MetricsAggregationType.Avg,
        legend: "Memory used",
      },
    }),

    // Rows 9-11: Network throughput (cumulative counters -> rate)
    createChartComponent({
      title: "Network Receive Throughput",
      chartType: DashboardChartType.Area,
      top: 9,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "pve_network_receive_bytes",
        aggregationType: MetricsAggregationType.Sum,
        legend: "RX bytes/sec",
        transformAsRate: true,
      },
    }),
    createChartComponent({
      title: "Network Transmit Throughput",
      chartType: DashboardChartType.Area,
      top: 9,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "pve_network_transmit_bytes",
        aggregationType: MetricsAggregationType.Sum,
        legend: "TX bytes/sec",
        transformAsRate: true,
      },
    }),

    // Rows 12-14: Logs
    createLogStreamComponent({
      title: "Cluster Logs",
      top: 12,
      left: 0,
      width: 12,
      height: 3,
    }),
  ];

  const variables: Array<DashboardVariable> = [
    createTelemetryAttributeVariable({
      name: "cluster",
      label: "Cluster",
      attributeKey: "resource.proxmox.cluster.name",
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    variables,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 15),
  };
}

function createDockerSwarmDashboardConfig(): DashboardViewConfig {
  /*
   * Layout notes:
   *
   * - Node / service counts come from the Postgres inventory list widgets
   *   (DockerSwarmResource), never from Sum-of-gauge Value widgets — the
   *   same multiply-by-scrapes failure the Kubernetes/Proxmox templates
   *   document. The list-widget headers show the true current counts.
   *
   * - The only metrics that actually arrive are the docker_stats
   *   receiver's per-container metrics (container.cpu.utilization,
   *   container.memory.usage.total, container.pids.count, …). There are
   *   NO docker_swarm_* / pve_* metrics, so the charts average those
   *   per-container metrics across every task that reports them — a
   *   useful temperature signal for a wall dashboard. container.cpu
   *   .utilization is a ratio (0..1 per core); the chart leaves it raw.
   *
   * - The cluster variable scopes telemetry by the only resource
   *   attribute the agent stamps: resource.docker.swarm.cluster.name.
   */
  const components: Array<DashboardBaseComponent> = [
    // Row 0: Title
    createTextComponent({
      text: "Docker Swarm Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Rows 1-4: Live inventory from the Postgres snapshot
    createDockerSwarmNodeListComponent({
      title: "Nodes",
      top: 1,
      left: 0,
      width: 6,
      height: 4,
      maxRows: 25,
    }),
    createDockerSwarmServiceListComponent({
      title: "Services",
      top: 1,
      left: 6,
      width: 6,
      height: 4,
      maxRows: 25,
    }),

    // Row 5: Section header
    createTextComponent({
      text: "Container Resource Usage",
      top: 5,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Rows 6-8: CPU and memory trends (docker_stats per-container metrics)
    createChartComponent({
      title: "CPU Utilization (avg across containers)",
      chartType: DashboardChartType.Line,
      top: 6,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "container.cpu.utilization",
        aggregationType: MetricsAggregationType.Avg,
        legend: "CPU utilization",
      },
    }),
    createChartComponent({
      title: "Memory Usage (avg across containers)",
      chartType: DashboardChartType.Area,
      top: 6,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "container.memory.usage.total",
        aggregationType: MetricsAggregationType.Avg,
        legend: "Memory used",
      },
    }),

    // Rows 9-11: PID counts + logs
    createChartComponent({
      title: "Process Count (sum across containers)",
      chartType: DashboardChartType.Line,
      top: 9,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "container.pids.count",
        aggregationType: MetricsAggregationType.Sum,
        legend: "PIDs",
      },
    }),
    createLogStreamComponent({
      title: "Cluster Logs",
      top: 9,
      left: 6,
      width: 6,
      height: 3,
    }),
  ];

  const variables: Array<DashboardVariable> = [
    createTelemetryAttributeVariable({
      name: "cluster",
      label: "Cluster",
      attributeKey: "resource.docker.swarm.cluster.name",
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    variables,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 12),
  };
}

function createCephDashboardConfig(): DashboardViewConfig {
  /*
   * Layout notes:
   *
   * - The OSD wall (honeycomb) and pool capacity list read the Postgres
   *   inventory, so their headers show true current counts — same
   *   Sum-of-gauge reasoning as the Kubernetes / Proxmox templates.
   *
   * - ceph_health_status is a single per-cluster gauge (0 OK / 1 WARN /
   *   2 ERR), so a Max Value widget renders it correctly.
   *
   * - ceph_pool_rd_bytes / ceph_pool_wr_bytes are cumulative counters,
   *   so the client-throughput charts use transformAsRate.
   */
  const components: Array<DashboardBaseComponent> = [
    // Row 0: Title
    createTextComponent({
      text: "Ceph Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Rows 1-4: Live inventory from the Postgres snapshot
    createCephOsdListComponent({
      title: "OSDs",
      top: 1,
      left: 0,
      width: 6,
      height: 4,
      maxRows: 100,
    }),
    createCephPoolListComponent({
      title: "Pools",
      top: 1,
      left: 6,
      width: 6,
      height: 4,
      maxRows: 25,
    }),

    // Row 5: Section header
    createTextComponent({
      text: "Health & Capacity",
      top: 5,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 6: Health and capacity stats
    createValueComponent({
      title: "Health (0 OK / 1 WARN / 2 ERR)",
      top: 6,
      left: 0,
      width: 4,
      metricConfig: {
        metricName: "ceph_health_status",
        aggregationType: MetricsAggregationType.Max,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createValueComponent({
      title: "Capacity Used",
      top: 6,
      left: 4,
      width: 4,
      metricConfig: {
        metricName: "ceph_cluster_total_used_bytes",
        aggregationType: MetricsAggregationType.Avg,
      },
      trendDirection: DashboardValueTrendDirection.HigherIsWorse,
    }),
    createValueComponent({
      title: "Capacity Total",
      top: 6,
      left: 8,
      width: 4,
      metricConfig: {
        metricName: "ceph_cluster_total_bytes",
        aggregationType: MetricsAggregationType.Avg,
      },
    }),

    // Rows 7-9: Capacity growth and PG health
    createChartComponent({
      title: "Capacity Used Over Time",
      chartType: DashboardChartType.Area,
      top: 7,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "ceph_cluster_total_used_bytes",
        aggregationType: MetricsAggregationType.Avg,
        legend: "Used bytes",
      },
    }),
    createChartComponent({
      title: "Degraded PGs",
      chartType: DashboardChartType.Line,
      top: 7,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "ceph_pg_degraded",
        aggregationType: MetricsAggregationType.Max,
        legend: "Degraded PGs",
      },
    }),

    // Rows 10-12: Client throughput (cumulative counters -> rate)
    createChartComponent({
      title: "Client Read Throughput",
      chartType: DashboardChartType.Area,
      top: 10,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "ceph_pool_rd_bytes",
        aggregationType: MetricsAggregationType.Sum,
        legend: "Read bytes/sec",
        transformAsRate: true,
      },
    }),
    createChartComponent({
      title: "Client Write Throughput",
      chartType: DashboardChartType.Area,
      top: 10,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "ceph_pool_wr_bytes",
        aggregationType: MetricsAggregationType.Sum,
        legend: "Write bytes/sec",
        transformAsRate: true,
      },
    }),

    // Rows 13-15: Logs (the agent's filelog receiver ships ceph.log)
    createLogStreamComponent({
      title: "Cluster Logs",
      top: 13,
      left: 0,
      width: 12,
      height: 3,
    }),
  ];

  const variables: Array<DashboardVariable> = [
    createTelemetryAttributeVariable({
      name: "cluster",
      label: "Cluster",
      attributeKey: "resource.ceph.cluster.name",
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    variables,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 16),
  };
}

export function getTemplateConfig(
  type: DashboardTemplateType,
): DashboardViewConfig | null {
  switch (type) {
    case DashboardTemplateType.Monitor:
      return createMonitorDashboardConfig();
    case DashboardTemplateType.Incident:
      return createIncidentDashboardConfig();
    case DashboardTemplateType.Kubernetes:
      return createKubernetesDashboardConfig();
    case DashboardTemplateType.Host:
      return createHostDashboardConfig();
    case DashboardTemplateType.Proxmox:
      return createProxmoxDashboardConfig();
    case DashboardTemplateType.Ceph:
      return createCephDashboardConfig();
    case DashboardTemplateType.DockerSwarm:
      return createDockerSwarmDashboardConfig();
    case DashboardTemplateType.Metrics:
      return createMetricsDashboardConfig();
    case DashboardTemplateType.Blank:
      return null;
  }
}
