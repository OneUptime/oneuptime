import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import SideMenu, {
  SideMenuSectionProps,
  SideMenuItemProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
  monitorType: MonitorType;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isProbeableMonitor: boolean = MonitorTypeHelper.isProbableMonitor(
    props.monitorType,
  );

  const isManualMonitor: boolean = MonitorTypeHelper.isManualMonitor(
    props.monitorType,
  );

  const isTelemetryMonitor: boolean = MonitorTypeHelper.isTelemetryMonitor(
    props.monitorType,
  );

  // Overview section items
  const overviewItems: SideMenuItemProps[] = [
    {
      link: {
        title: "Overview",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.Info,
    },
  ];

  if (MonitorTypeHelper.doesMonitorTypeHaveGraphs(props.monitorType)) {
    overviewItems.push({
      link: {
        title: "Metrics",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_METRICS] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.Graph,
    });
  }

  overviewItems.push({
    link: {
      title: "Status Timeline",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.MONITOR_VIEW_STATUS_TIMELINE] as Route,
        { modelId: props.modelId },
      ),
    },
    icon: IconProp.List,
  });

  // Activity section items
  const activityItems: SideMenuItemProps[] = [
    {
      link: {
        title: "Incidents",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_INCIDENTS] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.Alert,
    },
    {
      link: {
        title: "Alerts",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_ALERTS] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.ExclaimationCircle,
    },
    {
      link: {
        title: "Notification Logs",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_NOTIFICATION_LOGS] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.Bell,
    },
  ];

  if (!isManualMonitor && !isTelemetryMonitor) {
    activityItems.push({
      link: {
        title: "Monitoring Logs",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_LOGS] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.Logs,
    });
  }

  // Configuration section items
  const configurationItems: SideMenuItemProps[] = [];

  if (MonitorTypeHelper.doesMonitorTypeHaveCriteria(props.monitorType)) {
    configurationItems.push({
      link: {
        title: "Criteria",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_CRITERIA] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.Criteria,
    });
  }

  if (isProbeableMonitor) {
    configurationItems.push({
      link: {
        title: "Interval",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_INTERVAL] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.Clock,
    });

    configurationItems.push({
      link: {
        title: "Probes",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_PROBES] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.Signal,
    });
  }

  if (MonitorTypeHelper.doesMonitorTypeHaveDocumentation(props.monitorType)) {
    configurationItems.push({
      link: {
        title: "Documentation",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_DOCUMENTATION] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.Book,
    });
  }

  // Settings section items
  const settingsItems: SideMenuItemProps[] = [
    {
      link: {
        title: "Owners",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_OWNERS] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.Team,
    },
    {
      link: {
        title: "Custom Fields",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_CUSTOM_FIELDS] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.TableCells,
    },
    {
      link: {
        title: "Settings",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_SETTINGS] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.Settings,
    },
    {
      link: {
        title: "Delete Monitor",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW_DELETE] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.Trash,
      className: "danger-on-hover",
    },
  ];

  // Build sections array
  const sections: SideMenuSectionProps[] = [
    {
      title: "Overview",
      items: overviewItems,
    },
    {
      title: "Activity",
      items: activityItems,
    },
  ];

  // Only add Configuration section if there are items
  if (configurationItems.length > 0) {
    sections.push({
      title: "Configuration",
      items: configurationItems,
    });
  }

  sections.push({
    title: "Settings",
    items: settingsItems,
  });

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
