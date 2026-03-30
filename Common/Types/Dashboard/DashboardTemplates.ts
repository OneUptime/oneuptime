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

export enum DashboardTemplateType {
  Blank = "Blank",
  Monitor = "Monitor",
  Incident = "Incident",
  Kubernetes = "Kubernetes",
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
    createValueComponent({
      title: "Uptime %",
      top: 1,
      left: 3,
      width: 3,
      metricConfig: {
        metricName: MonitorMetricType.IsOnline,
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "%",
      },
    }),
    createValueComponent({
      title: "Error Rate",
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
        legend: "Online Status",
        legendUnit: "%",
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
        legendUnit: "min",
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
        legendUnit: "min",
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
        legendUnit: "min",
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
        legendUnit: "min",
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

    // Row 6-8: Gauges for MTTR/MTTA and resolution chart
    createGaugeComponent({
      title: "MTTR (minutes)",
      top: 6,
      left: 0,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 120,
      warningThreshold: 60,
      criticalThreshold: 90,
      metricConfig: {
        metricName: IncidentMetricType.TimeToResolve,
        aggregationType: MetricsAggregationType.Avg,
      },
    }),
    createGaugeComponent({
      title: "MTTA (minutes)",
      top: 6,
      left: 3,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 60,
      warningThreshold: 15,
      criticalThreshold: 30,
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
        legendUnit: "min",
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
        legendUnit: "min",
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

    // Row 1: Key cluster metrics
    createValueComponent({
      title: "CPU Usage",
      top: 1,
      left: 0,
      width: 3,
      metricConfig: {
        metricName: "k8s.pod.cpu.utilization",
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "%",
      },
    }),
    createValueComponent({
      title: "Memory Usage",
      top: 1,
      left: 3,
      width: 3,
      metricConfig: {
        metricName: "k8s.pod.memory.usage",
        aggregationType: MetricsAggregationType.Avg,
        legendUnit: "bytes",
      },
    }),
    createValueComponent({
      title: "Pod Count",
      top: 1,
      left: 6,
      width: 3,
      metricConfig: {
        metricName: "k8s.pod.phase",
        aggregationType: MetricsAggregationType.Sum,
      },
    }),
    createValueComponent({
      title: "Node Ready",
      top: 1,
      left: 9,
      width: 3,
      metricConfig: {
        metricName: "k8s.node.condition_ready",
        aggregationType: MetricsAggregationType.Sum,
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
        legendUnit: "%",
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
        legendUnit: "bytes",
      },
    }),

    // Row 5: Section header
    createTextComponent({
      text: "Resource Health",
      top: 5,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 6-8: Gauges and pod chart
    createGaugeComponent({
      title: "CPU Utilization",
      top: 6,
      left: 0,
      width: 3,
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
    createGaugeComponent({
      title: "Memory Utilization",
      top: 6,
      left: 3,
      width: 3,
      height: 3,
      minValue: 0,
      maxValue: 100,
      warningThreshold: 70,
      criticalThreshold: 90,
      metricConfig: {
        metricName: "k8s.node.memory.usage",
        aggregationType: MetricsAggregationType.Avg,
      },
    }),
    createChartComponent({
      title: "Pod Count Over Time",
      chartType: DashboardChartType.StackedArea,
      top: 6,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "k8s.pod.phase",
        aggregationType: MetricsAggregationType.Sum,
        legend: "Pods",
      },
    }),

    // Row 9: Section header
    createTextComponent({
      text: "Workload Details",
      top: 9,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),

    // Row 10-12: Network, restarts
    createChartComponent({
      title: "Network I/O",
      chartType: DashboardChartType.Area,
      top: 10,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "k8s.pod.network.io",
        aggregationType: MetricsAggregationType.Sum,
        legend: "Network I/O",
        legendUnit: "bytes",
      },
    }),
    createChartComponent({
      title: "Container Restarts Over Time",
      chartType: DashboardChartType.Bar,
      top: 10,
      left: 6,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "k8s.container.restarts",
        aggregationType: MetricsAggregationType.Max,
        legend: "Restarts",
      },
    }),

    // Row 13-15: Table and logs
    createTableComponent({
      title: "Deployment Replicas",
      top: 13,
      left: 0,
      width: 6,
      height: 3,
      metricConfig: {
        metricName: "k8s.deployment.available_replicas",
        aggregationType: MetricsAggregationType.Min,
      },
    }),
    createLogStreamComponent({
      title: "Cluster Logs",
      top: 13,
      left: 6,
      width: 6,
      height: 3,
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
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
    case DashboardTemplateType.Blank:
      return null;
  }
}
