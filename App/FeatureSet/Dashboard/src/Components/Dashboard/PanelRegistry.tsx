/**
 * Panel registry — single source of truth for everything a dashboard panel
 * type contributes:
 *   - the React component that renders it
 *   - the static factory that produces the default config when added
 *   - the toolbar add-menu metadata (label + icon)
 *
 * Adding a new panel type should be a one-file change here, plus the
 * panel's own renderer + util factory.
 */
import React, { ComponentType } from "react";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import IconProp from "Common/Types/Icon/IconProp";

import DashboardChartComponent from "./Components/DashboardChartComponent";
import DashboardValueComponent from "./Components/DashboardValueComponent";
import DashboardTextComponent from "./Components/DashboardTextComponent";
import DashboardTableComponent from "./Components/DashboardTableComponent";
import DashboardGaugeComponent from "./Components/DashboardGaugeComponent";
import DashboardLogStreamComponent from "./Components/DashboardLogStreamComponent";
import DashboardTraceListComponent from "./Components/DashboardTraceListComponent";
import DashboardAlertListComponent from "./Components/DashboardAlertListComponent";
import DashboardMonitorStatusComponent from "./Components/DashboardMonitorStatusComponent";
import DashboardEmbedComponent from "./Components/DashboardEmbedComponent";

import DashboardChartComponentUtil from "Common/Utils/Dashboard/Components/DashboardChartComponent";
import DashboardValueComponentUtil from "Common/Utils/Dashboard/Components/DashboardValueComponent";
import DashboardTextComponentUtil from "Common/Utils/Dashboard/Components/DashboardTextComponent";
import DashboardTableComponentUtil from "Common/Utils/Dashboard/Components/DashboardTableComponent";
import DashboardGaugeComponentUtil from "Common/Utils/Dashboard/Components/DashboardGaugeComponent";
import DashboardLogStreamComponentUtil from "Common/Utils/Dashboard/Components/DashboardLogStreamComponent";
import DashboardTraceListComponentUtil from "Common/Utils/Dashboard/Components/DashboardTraceListComponent";
import DashboardAlertListComponentUtil from "Common/Utils/Dashboard/Components/DashboardAlertListComponent";
import DashboardMonitorStatusComponentUtil from "Common/Utils/Dashboard/Components/DashboardMonitorStatusComponent";
import DashboardEmbedComponentUtil from "Common/Utils/Dashboard/Components/DashboardEmbedComponent";

import { DashboardBaseComponentProps } from "./Components/DashboardBaseComponent";

export interface PanelRendererProps extends DashboardBaseComponentProps {
  /*
   * The renderer takes the same props as DashboardBaseComponentProps plus a
   * narrowed `component`. Each renderer casts to its concrete type.
   */
  component: DashboardBaseComponent;
  isEditMode: boolean;
  isSelected: boolean;
}

export interface PanelDefinition {
  type: DashboardComponentType;
  label: string;
  icon: IconProp;
  /*
   * Renderer accepts the strongly-typed props for its concrete component;
   * we widen here to allow the registry to be uniform.
   */
  Renderer: ComponentType<PanelRendererProps>;
  /*
   * Factory that produces the default component config when added from the
   * toolbar.
   */
  createDefault: () => DashboardBaseComponent;
}

const definitions: Array<PanelDefinition> = [
  {
    type: DashboardComponentType.Chart,
    label: "Chart",
    icon: IconProp.ChartBar,
    Renderer:
      DashboardChartComponent as unknown as ComponentType<PanelRendererProps>,
    createDefault: () => {
      return DashboardChartComponentUtil.getDefaultComponent();
    },
  },
  {
    type: DashboardComponentType.Value,
    label: "Value",
    icon: IconProp.Hashtag,
    Renderer:
      DashboardValueComponent as unknown as ComponentType<PanelRendererProps>,
    createDefault: () => {
      return DashboardValueComponentUtil.getDefaultComponent();
    },
  },
  {
    type: DashboardComponentType.Text,
    label: "Text",
    icon: IconProp.Text,
    Renderer:
      DashboardTextComponent as unknown as ComponentType<PanelRendererProps>,
    createDefault: () => {
      return DashboardTextComponentUtil.getDefaultComponent();
    },
  },
  {
    type: DashboardComponentType.Table,
    label: "Table",
    icon: IconProp.TableCells,
    Renderer:
      DashboardTableComponent as unknown as ComponentType<PanelRendererProps>,
    createDefault: () => {
      return DashboardTableComponentUtil.getDefaultComponent();
    },
  },
  {
    type: DashboardComponentType.Gauge,
    label: "Gauge",
    icon: IconProp.Gauge,
    Renderer:
      DashboardGaugeComponent as unknown as ComponentType<PanelRendererProps>,
    createDefault: () => {
      return DashboardGaugeComponentUtil.getDefaultComponent();
    },
  },
  {
    type: DashboardComponentType.LogStream,
    label: "Log Stream",
    icon: IconProp.Logs,
    Renderer:
      DashboardLogStreamComponent as unknown as ComponentType<PanelRendererProps>,
    createDefault: () => {
      return DashboardLogStreamComponentUtil.getDefaultComponent();
    },
  },
  {
    type: DashboardComponentType.TraceList,
    label: "Trace List",
    icon: IconProp.Waterfall,
    Renderer:
      DashboardTraceListComponent as unknown as ComponentType<PanelRendererProps>,
    createDefault: () => {
      return DashboardTraceListComponentUtil.getDefaultComponent();
    },
  },
  {
    type: DashboardComponentType.AlertList,
    label: "Alert / Incident List",
    icon: IconProp.Alert,
    Renderer:
      DashboardAlertListComponent as unknown as ComponentType<PanelRendererProps>,
    createDefault: () => {
      return DashboardAlertListComponentUtil.getDefaultComponent();
    },
  },
  {
    type: DashboardComponentType.MonitorStatus,
    label: "Monitor Status",
    icon: IconProp.Activity,
    Renderer:
      DashboardMonitorStatusComponent as unknown as ComponentType<PanelRendererProps>,
    createDefault: () => {
      return DashboardMonitorStatusComponentUtil.getDefaultComponent();
    },
  },
  {
    type: DashboardComponentType.Embed,
    label: "Embed (iframe)",
    icon: IconProp.ExternalLink,
    Renderer:
      DashboardEmbedComponent as unknown as ComponentType<PanelRendererProps>,
    createDefault: () => {
      return DashboardEmbedComponentUtil.getDefaultComponent();
    },
  },
];

const definitionByType: Record<string, PanelDefinition> = definitions.reduce(
  (
    acc: Record<string, PanelDefinition>,
    def: PanelDefinition,
  ): Record<string, PanelDefinition> => {
    acc[def.type] = def;
    return acc;
  },
  {} as Record<string, PanelDefinition>,
);

export const PanelDefinitions: ReadonlyArray<PanelDefinition> = definitions;

export const getPanelDefinition: (
  type: DashboardComponentType,
) => PanelDefinition | undefined = (
  type: DashboardComponentType,
): PanelDefinition | undefined => {
  return definitionByType[type];
};

export const renderPanel: (
  type: DashboardComponentType,
  props: PanelRendererProps,
) => React.ReactElement | null = (
  type: DashboardComponentType,
  props: PanelRendererProps,
): React.ReactElement | null => {
  const def: PanelDefinition | undefined = getPanelDefinition(type);
  if (!def) {
    return null;
  }
  const Renderer: ComponentType<PanelRendererProps> = def.Renderer;
  return <Renderer {...props} />;
};
