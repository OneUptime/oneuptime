import DashboardViewConfig from "./DashboardViewConfig";
import { ObjectType } from "../JSON";
import DashboardSize from "./DashboardSize";
import DashboardComponentType from "./DashboardComponentType";
import DashboardChartType from "./Chart/ChartType";
import ObjectID from "../ObjectID";
import DashboardBaseComponent from "./DashboardComponents/DashboardBaseComponent";
import IconProp from "../Icon/IconProp";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import IncidentMetricType from "../Incident/IncidentMetricType";
import MonitorMetricType from "../Monitor/MonitorMetricType";
import SpanMetricType from "../Span/SpanMetricType";
import ExceptionMetricType from "../Exception/ExceptionMetricType";
import ProfileMetricType from "../Profile/ProfileMetricType";
import MetricDashboardMetricType from "../Metrics/MetricDashboardMetricType";

export enum DashboardTemplateType {
  Blank = "Blank",
  Monitor = "Monitor",
  Incident = "Incident",
  Kubernetes = "Kubernetes",
  Metrics = "Metrics",
  Trace = "Trace",
  Exception = "Exception",
  Profiles = "Profiles",
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
      "Response time, uptime, error rate, throughput charts, health gauges, and logs.",
    icon: IconProp.Heartbeat,
  },
  {
    type: DashboardTemplateType.Incident,
    name: "Incident Dashboard",
    description:
      "MTTR/MTTA gauges, incident trends, severity breakdown, duration tables, logs, and traces.",
    icon: IconProp.Alert,
  },
  {
    type: DashboardTemplateType.Kubernetes,
    name: "Kubernetes Dashboard",
    description:
      "CPU/memory gauges, pod and node metrics, network I/O, restart trends, and cluster logs.",
    icon: IconProp.Kubernetes,
  },
  {
    type: DashboardTemplateType.Metrics,
    name: "Metrics Dashboard",
    description:
      "HTTP request rates, latency percentiles, error rates, system resource usage, and custom application metrics.",
    icon: IconProp.ChartBar,
  },
  {
    type: DashboardTemplateType.Trace,
    name: "Trace Dashboard",
    description:
      "Span throughput, latency percentiles, error rates, service health, status breakdown, and recent traces.",
    icon: IconProp.Activity,
  },
  {
    type: DashboardTemplateType.Exception,
    name: "Exception Dashboard",
    description:
      "Exception counts, error rates, top exception types, resolution status, affected services, and logs.",
    icon: IconProp.Bug,
  },
  {
    type: DashboardTemplateType.Profiles,
    name: "Profiles Dashboard",
    description:
      "CPU profiles, memory allocations, heap usage, thread counts, top functions by CPU time, and flamegraph data.",
    icon: IconProp.Fire,
  },
];

// -- Metric query config helpers --

interface MetricConfig {
  metricName: string;
  aggregationType: MetricsAggregationType;
  legend?: string;
  legendUnit?: string;
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
      groupBy: undefined,
    },
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

function createTraceListComponent(data: {
  title: string;
  top: number;
  left: number;
  width: number;
  height: number;
  maxRows?: number;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.TraceList,
    componentId: ObjectID.generate(),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minHeightInDashboardUnits: 3,
    minWidthInDashboardUnits: 6,
    arguments: {
      title: data.title,
      maxRows: data.maxRows ?? 20,
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

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
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

    // Row 1: Key incident metrics
    createValueComponent({
      title: "Incident Count",
      top: 1,
      left: 0,
      width: 3,
      metricConfig: {
        metricName: IncidentMetricType.IncidentCount,
        aggregationType: MetricsAggregationType.Sum,
      },
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

    // Row 14-16: Tables
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

    // Row 17-19: Logs and traces
    createLogStreamComponent({
      title: "Recent Incident Logs",
      top: 17,
      left: 0,
      width: 6,
      height: 3,
    }),
    createTraceListComponent({
      title: "Recent Traces",
      top: 17,
      left: 6,
      width: 6,
      height: 3,
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 20),
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
   * - CPU widgets use OTel's k8s.*.cpu.utilization, which the collector
   *   emits as a [0, 1] ratio with unit "1". DashboardValueComponent /
   *   DashboardGaugeComponent now scale that to a percent at render time
   *   when the metric name carries the `.utilization` suffix, so "0.05"
   *   reads as "5.00%" and gauge thresholds in the natural 0-100 scale work
   *   as expected.
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
     * ValueFormatter (CPU utilization → "%", memory.usage → "MB"/"GB").
     */
    createValueComponent({
      title: "Pod CPU (avg)",
      top: 1,
      left: 0,
      width: 3,
      metricConfig: {
        metricName: "k8s.pod.cpu.utilization",
        aggregationType: MetricsAggregationType.Avg,
      },
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
    }),
    createValueComponent({
      title: "Node CPU (avg)",
      top: 1,
      left: 6,
      width: 3,
      metricConfig: {
        metricName: "k8s.node.cpu.utilization",
        aggregationType: MetricsAggregationType.Avg,
      },
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
    }),

    // Row 2-4: Resource usage charts
    createChartComponent({
      title: "CPU Usage Over Time",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "k8s.pod.cpu.utilization",
        aggregationType: MetricsAggregationType.Avg,
        legend: "CPU Utilization",
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
     * Row 11-13: CPU gauge (auto-scaled from [0,1] to percent), and the
     * network throughput chart. The old "Memory Utilization" gauge over
     * raw bytes is gone — see top-of-function comment.
     */
    createGaugeComponent({
      title: "Cluster CPU Utilization",
      top: 11,
      left: 0,
      width: 4,
      height: 3,
      minValue: 0,
      maxValue: 100,
      warningThreshold: 70,
      criticalThreshold: 90,
      metricConfig: {
        metricName: "k8s.node.cpu.utilization",
        aggregationType: MetricsAggregationType.Avg,
      },
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

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
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

    // Row 1: Key HTTP metrics
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

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 24),
  };
}

function createTraceDashboardConfig(): DashboardViewConfig {
  const components: Array<DashboardBaseComponent> = [
    // Row 0: Title
    createTextComponent({
      text: "Trace Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 1: Key trace metrics
    createValueComponent({
      title: "Span Count",
      top: 1,
      left: 0,
      width: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanCount,
        aggregationType: MetricsAggregationType.Sum,
      },
    }),
    createValueComponent({
      title: "Avg Duration",
      top: 1,
      left: 3,
      width: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanDuration,
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "ms",
      },
    }),
    createValueComponent({
      title: "Error Rate",
      top: 1,
      left: 6,
      width: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanErrorRate,
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "%",
      },
    }),
    createValueComponent({
      title: "Throughput",
      top: 1,
      left: 9,
      width: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanThroughput,
        aggregationType: MetricsAggregationType.Sum,
        legendUnit: "req/s",
      },
    }),

    // Row 2-4: Throughput and duration charts
    createChartComponent({
      title: "Span Throughput Over Time",
      chartType: DashboardChartType.Bar,
      top: 2,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanCount,
        aggregationType: MetricsAggregationType.Sum,
        legend: "Spans",
      },
    }),
    createChartComponent({
      title: "Avg Span Duration Over Time",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanDuration,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Avg Duration",
        legendUnit: "ms",
      },
    }),

    // Row 5: Section header
    createTextComponent({
      text: "Latency Percentiles",
      top: 5,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 6: Latency percentile values
    createValueComponent({
      title: "P50 Latency",
      top: 6,
      left: 0,
      width: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanP50Duration,
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "ms",
      },
    }),
    createValueComponent({
      title: "P90 Latency",
      top: 6,
      left: 3,
      width: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanP90Duration,
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "ms",
      },
    }),
    createValueComponent({
      title: "P95 Latency",
      top: 6,
      left: 6,
      width: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanP95Duration,
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "ms",
      },
    }),
    createValueComponent({
      title: "P99 Latency",
      top: 6,
      left: 9,
      width: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanP99Duration,
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "ms",
      },
    }),

    // Row 7-9: Latency percentile charts
    createChartComponent({
      title: "Latency Percentiles Over Time",
      chartType: DashboardChartType.Line,
      top: 7,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanP95Duration,
        aggregationType: MetricsAggregationType.Avg,
        legend: "P95 Latency",
        legendUnit: "ms",
      },
    }),
    createChartComponent({
      title: "Latency Distribution",
      chartType: DashboardChartType.Histogram,
      top: 7,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanDuration,
        aggregationType: MetricsAggregationType.Count,
        legend: "Latency Distribution",
        legendUnit: "ms",
      },
    }),

    // Row 10: Section header
    createTextComponent({
      text: "Error Analysis",
      top: 10,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 11-13: Error charts and status breakdown
    createGaugeComponent({
      title: "Error Rate",
      top: 11,
      left: 0,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 100,
      warningThreshold: 5,
      criticalThreshold: 15,
      metricConfig: {
        metricName: SpanMetricType.SpanErrorRate,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),
    createChartComponent({
      title: "Errors Over Time",
      chartType: DashboardChartType.Area,
      top: 11,
      left: 3,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanErrorCount,
        aggregationType: MetricsAggregationType.Sum,
        legend: "Errors",
      },
    }),
    createChartComponent({
      title: "Span Status Breakdown",
      chartType: DashboardChartType.Pie,
      top: 11,
      left: 9,
      width: 3,
      height: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanStatusOk,
        aggregationType: MetricsAggregationType.Count,
        legend: "Status",
      },
    }),

    // Row 14: Section header
    createTextComponent({
      text: "Trace Details",
      top: 14,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 15-17: Table of slowest spans and request rate
    createTableComponent({
      title: "Slowest Spans",
      top: 15,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanDuration,
        aggregationType: MetricsAggregationType.Max,
      },
    }),
    createChartComponent({
      title: "Request Rate Over Time",
      chartType: DashboardChartType.StackedArea,
      top: 15,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: SpanMetricType.SpanRequestRate,
        aggregationType: MetricsAggregationType.Sum,
        legend: "Request Rate",
        legendUnit: "req/s",
      },
    }),

    // Row 18-20: Recent traces and logs
    createTraceListComponent({
      title: "Recent Traces",
      top: 18,
      left: 0,
      width: 6,
      height: 3,
    }),
    createLogStreamComponent({
      title: "Related Logs",
      top: 18,
      left: 6,
      width: 6,
      height: 3,
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 21),
  };
}

function createExceptionDashboardConfig(): DashboardViewConfig {
  const components: Array<DashboardBaseComponent> = [
    // Row 0: Title
    createTextComponent({
      text: "Exception Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 1: Key exception metrics
    createValueComponent({
      title: "Total Exceptions",
      top: 1,
      left: 0,
      width: 3,
      metricConfig: {
        metricName: ExceptionMetricType.ExceptionCount,
        aggregationType: MetricsAggregationType.Sum,
      },
    }),
    createValueComponent({
      title: "Exception Rate",
      top: 1,
      left: 3,
      width: 3,
      metricConfig: {
        metricName: ExceptionMetricType.ExceptionRate,
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "/min",
      },
    }),
    createValueComponent({
      title: "Unresolved",
      top: 1,
      left: 6,
      width: 3,
      metricConfig: {
        metricName: ExceptionMetricType.UnresolvedExceptionCount,
        aggregationType: MetricsAggregationType.Sum,
      },
    }),
    createValueComponent({
      title: "Affected Services",
      top: 1,
      left: 9,
      width: 3,
      metricConfig: {
        metricName: ExceptionMetricType.ExceptionAffectedServiceCount,
        aggregationType: MetricsAggregationType.Sum,
      },
    }),

    // Row 2-4: Exception trends
    createChartComponent({
      title: "Exceptions Over Time",
      chartType: DashboardChartType.Bar,
      top: 2,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ExceptionMetricType.ExceptionCount,
        aggregationType: MetricsAggregationType.Sum,
        legend: "Exceptions",
      },
    }),
    createChartComponent({
      title: "Exception Rate Over Time",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ExceptionMetricType.ExceptionRate,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Exception Rate",
        legendUnit: "/min",
      },
    }),

    // Row 5: Section header
    createTextComponent({
      text: "Exception Breakdown",
      top: 5,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 6-8: Exception type and service breakdown
    createChartComponent({
      title: "Exceptions by Type",
      chartType: DashboardChartType.Pie,
      top: 6,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ExceptionMetricType.ExceptionCountByType,
        aggregationType: MetricsAggregationType.Count,
        legend: "Exception Type",
      },
    }),
    createChartComponent({
      title: "Exceptions by Service",
      chartType: DashboardChartType.Bar,
      top: 6,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ExceptionMetricType.ExceptionCountByService,
        aggregationType: MetricsAggregationType.Count,
        legend: "Service",
      },
    }),

    // Row 9: Section header
    createTextComponent({
      text: "Resolution Status",
      top: 9,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 10-12: Resolution gauges and resolution trends
    createGaugeComponent({
      title: "Unresolved Exceptions",
      top: 10,
      left: 0,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 100,
      warningThreshold: 25,
      criticalThreshold: 50,
      metricConfig: {
        metricName: ExceptionMetricType.UnresolvedExceptionCount,
        aggregationType: MetricsAggregationType.Sum,
      },
    }),
    createGaugeComponent({
      title: "Muted Exceptions",
      top: 10,
      left: 3,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 100,
      metricConfig: {
        metricName: ExceptionMetricType.MutedExceptionCount,
        aggregationType: MetricsAggregationType.Sum,
      },
    }),
    createChartComponent({
      title: "Resolution Status Over Time",
      chartType: DashboardChartType.StackedArea,
      top: 10,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ExceptionMetricType.ResolvedExceptionCount,
        aggregationType: MetricsAggregationType.Sum,
        legend: "Resolved",
      },
    }),

    // Row 13: Section header
    createTextComponent({
      text: "Exception Recurrence",
      top: 13,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 14-16: Occurrence trends and top exceptions table
    createChartComponent({
      title: "Exception Occurrences Over Time",
      chartType: DashboardChartType.Heatmap,
      top: 14,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ExceptionMetricType.ExceptionOccurrenceCount,
        aggregationType: MetricsAggregationType.Sum,
        legend: "Occurrences",
      },
    }),
    createTableComponent({
      title: "Top Exceptions by Occurrence",
      top: 14,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ExceptionMetricType.ExceptionOccurrenceCount,
        aggregationType: MetricsAggregationType.Max,
      },
    }),

    // Row 17: Section header
    createTextComponent({
      text: "Exception Details",
      top: 17,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 18-20: Logs and traces
    createLogStreamComponent({
      title: "Exception Logs",
      top: 18,
      left: 0,
      width: 6,
      height: 3,
    }),
    createTraceListComponent({
      title: "Related Traces",
      top: 18,
      left: 6,
      width: 6,
      height: 3,
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 21),
  };
}

function createProfilesDashboardConfig(): DashboardViewConfig {
  const components: Array<DashboardBaseComponent> = [
    // Row 0: Title
    createTextComponent({
      text: "Profiles Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 1: Key profile metrics
    createValueComponent({
      title: "Profile Count",
      top: 1,
      left: 0,
      width: 3,
      metricConfig: {
        metricName: ProfileMetricType.ProfileCount,
        aggregationType: MetricsAggregationType.Sum,
      },
    }),
    createValueComponent({
      title: "CPU Profile Duration",
      top: 1,
      left: 3,
      width: 3,
      metricConfig: {
        metricName: ProfileMetricType.CpuProfileDuration,
        aggregationType: MetricsAggregationType.Sum,
        legendUnit: "ms",
      },
    }),
    createValueComponent({
      title: "Memory Allocations",
      top: 1,
      left: 6,
      width: 3,
      metricConfig: {
        metricName: ProfileMetricType.MemoryAllocationCount,
        aggregationType: MetricsAggregationType.Sum,
      },
    }),
    createValueComponent({
      title: "Thread Count",
      top: 1,
      left: 9,
      width: 3,
      metricConfig: {
        metricName: ProfileMetricType.ThreadCount,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),

    // Row 2-4: CPU profile charts
    createChartComponent({
      title: "CPU Profile Duration Over Time",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ProfileMetricType.CpuProfileDuration,
        aggregationType: MetricsAggregationType.Avg,
        legend: "CPU Duration",
        legendUnit: "ms",
      },
    }),
    createChartComponent({
      title: "CPU Sample Count Over Time",
      chartType: DashboardChartType.Bar,
      top: 2,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ProfileMetricType.CpuProfileSampleCount,
        aggregationType: MetricsAggregationType.Sum,
        legend: "CPU Samples",
      },
    }),

    // Row 5: Section header
    createTextComponent({
      text: "Memory Profiling",
      top: 5,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 6-8: Memory gauges and allocation charts
    createGaugeComponent({
      title: "Heap Usage",
      top: 6,
      left: 0,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 100,
      warningThreshold: 70,
      criticalThreshold: 90,
      metricConfig: {
        metricName: ProfileMetricType.HeapUsage,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),
    createChartComponent({
      title: "Memory Allocation Size Over Time",
      chartType: DashboardChartType.Area,
      top: 6,
      left: 3,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ProfileMetricType.MemoryAllocationSize,
        aggregationType: MetricsAggregationType.Sum,
        legend: "Allocation Size",
        legendUnit: "bytes",
      },
    }),
    createGaugeComponent({
      title: "Thread Count",
      top: 6,
      left: 9,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 500,
      warningThreshold: 200,
      criticalThreshold: 400,
      metricConfig: {
        metricName: ProfileMetricType.ThreadCount,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),

    // Row 9: Section header
    createTextComponent({
      text: "Allocation Trends",
      top: 9,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 10-12: Allocation count trends and heap trends
    createChartComponent({
      title: "Memory Allocation Count Over Time",
      chartType: DashboardChartType.Bar,
      top: 10,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ProfileMetricType.MemoryAllocationCount,
        aggregationType: MetricsAggregationType.Sum,
        legend: "Allocations",
      },
    }),
    createChartComponent({
      title: "Heap Usage Over Time",
      chartType: DashboardChartType.Area,
      top: 10,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ProfileMetricType.HeapUsage,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Heap",
        legendUnit: "bytes",
      },
    }),

    // Row 13: Section header
    createTextComponent({
      text: "Runtime & Concurrency",
      top: 13,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 14-16: Wall clock, goroutines/threads, sample rate
    createChartComponent({
      title: "Wall Clock Duration Over Time",
      chartType: DashboardChartType.Line,
      top: 14,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ProfileMetricType.WallClockDuration,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Wall Clock",
        legendUnit: "ms",
      },
    }),
    createChartComponent({
      title: "Goroutine / Thread Count Over Time",
      chartType: DashboardChartType.StackedArea,
      top: 14,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ProfileMetricType.GoroutineCount,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Goroutines / Threads",
      },
    }),

    // Row 17: Section header
    createTextComponent({
      text: "Hot Functions",
      top: 17,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 18-20: Top functions tables
    createTableComponent({
      title: "Top Functions by CPU Time",
      top: 18,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ProfileMetricType.TopFunctionCpuTime,
        aggregationType: MetricsAggregationType.Max,
      },
    }),
    createTableComponent({
      title: "Top Functions by Allocations",
      top: 18,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ProfileMetricType.TopFunctionAllocations,
        aggregationType: MetricsAggregationType.Max,
      },
    }),

    // Row 21-23: Profile sample rate and logs
    createChartComponent({
      title: "Profile Sample Rate Over Time",
      chartType: DashboardChartType.Line,
      top: 21,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: ProfileMetricType.ProfileSampleRate,
        aggregationType: MetricsAggregationType.Avg,
        legend: "Sample Rate",
        legendUnit: "samples/s",
      },
    }),
    createLogStreamComponent({
      title: "Related Logs",
      top: 21,
      left: 6,
      width: 6,
      height: 3,
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    heightInDashboardUnits: Math.max(DashboardSize.heightInDashboardUnits, 24),
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
    case DashboardTemplateType.Metrics:
      return createMetricsDashboardConfig();
    case DashboardTemplateType.Trace:
      return createTraceDashboardConfig();
    case DashboardTemplateType.Exception:
      return createExceptionDashboardConfig();
    case DashboardTemplateType.Profiles:
      return createProfilesDashboardConfig();
    case DashboardTemplateType.Blank:
      return null;
  }
}
