import DashboardViewConfig from "./DashboardViewConfig";
import { ObjectType } from "../JSON";
import DashboardSize from "./DashboardSize";
import DashboardComponentType from "./DashboardComponentType";
import DashboardChartType from "./Chart/ChartType";
import ObjectID from "../ObjectID";
import DashboardBaseComponent from "./DashboardComponents/DashboardBaseComponent";
import IconProp from "../Icon/IconProp";

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
      "Pre-configured with response time, uptime, and throughput widgets.",
    icon: IconProp.Activity,
  },
  {
    type: DashboardTemplateType.Incident,
    name: "Incident Dashboard",
    description:
      "Track active incidents, MTTR, MTTA, and view recent logs.",
    icon: IconProp.Alert,
  },
  {
    type: DashboardTemplateType.Kubernetes,
    name: "Kubernetes Dashboard",
    description:
      "Monitor CPU, memory, pod count, and resource usage over time.",
    icon: IconProp.Kubernetes,
  },
];

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
      metricQueryConfig: {
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
      metricQueryConfig: {
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

function createMonitorDashboardConfig(): DashboardViewConfig {
  const components: Array<DashboardBaseComponent> = [
    createTextComponent({
      text: "Monitor Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),
    createValueComponent({ title: "Response Time", top: 1, left: 0, width: 4 }),
    createValueComponent({ title: "Uptime %", top: 1, left: 4, width: 4 }),
    createValueComponent({ title: "Error Rate", top: 1, left: 8, width: 4 }),
    createChartComponent({
      title: "Response Time Over Time",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 0,
      width: 6,
      height: 3,
    }),
    createChartComponent({
      title: "Request Throughput",
      chartType: DashboardChartType.Area,
      top: 2,
      left: 6,
      width: 6,
      height: 3,
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    heightInDashboardUnits: Math.max(
      DashboardSize.heightInDashboardUnits,
      5,
    ),
  };
}

function createIncidentDashboardConfig(): DashboardViewConfig {
  const components: Array<DashboardBaseComponent> = [
    createTextComponent({
      text: "Incident Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),
    createValueComponent({
      title: "Active Incidents",
      top: 1,
      left: 0,
      width: 4,
    }),
    createValueComponent({ title: "MTTR", top: 1, left: 4, width: 4 }),
    createValueComponent({ title: "MTTA", top: 1, left: 8, width: 4 }),
    createChartComponent({
      title: "Incidents Over Time",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 0,
      width: 6,
      height: 3,
    }),
    createLogStreamComponent({
      title: "Recent Logs",
      top: 2,
      left: 6,
      width: 6,
      height: 3,
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    heightInDashboardUnits: Math.max(
      DashboardSize.heightInDashboardUnits,
      5,
    ),
  };
}

function createKubernetesDashboardConfig(): DashboardViewConfig {
  const components: Array<DashboardBaseComponent> = [
    createTextComponent({
      text: "Kubernetes Dashboard",
      top: 0,
      left: 0,
      width: 12,
      height: 1,
      isBold: true,
    }),
    createValueComponent({ title: "CPU Usage", top: 1, left: 0, width: 4 }),
    createValueComponent({
      title: "Memory Usage",
      top: 1,
      left: 4,
      width: 4,
    }),
    createValueComponent({ title: "Pod Count", top: 1, left: 8, width: 4 }),
    createChartComponent({
      title: "CPU Usage Over Time",
      chartType: DashboardChartType.Line,
      top: 2,
      left: 0,
      width: 6,
      height: 3,
    }),
    createChartComponent({
      title: "Memory Usage Over Time",
      chartType: DashboardChartType.Area,
      top: 2,
      left: 6,
      width: 6,
      height: 3,
    }),
  ];

  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    heightInDashboardUnits: Math.max(
      DashboardSize.heightInDashboardUnits,
      5,
    ),
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
