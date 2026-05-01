import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import BadDataException from "../../../Types/Exception/BadDataException";
import DashboardChartComponentUtil from "./DashboardChartComponent";
import DashboardGaugeComponentUtil from "./DashboardGaugeComponent";
import DashboardLogStreamComponentUtil from "./DashboardLogStreamComponent";
import DashboardTableComponentUtil from "./DashboardTableComponent";
import DashboardTextComponentUtil from "./DashboardTextComponent";
import DashboardTraceListComponentUtil from "./DashboardTraceListComponent";
import DashboardValueComponentUtil from "./DashboardValueComponent";
import DashboardAlertListComponentUtil from "./DashboardAlertListComponent";
import DashboardMonitorStatusComponentUtil from "./DashboardMonitorStatusComponent";
import DashboardEmbedComponentUtil from "./DashboardEmbedComponent";

export default class DashboardComponentsUtil {
  public static getComponentSettingsArguments(
    dashboardComponentType: DashboardComponentType,
  ): Array<ComponentArgument<DashboardBaseComponent>> {
    if (dashboardComponentType === DashboardComponentType.Chart) {
      return DashboardChartComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.Text) {
      return DashboardTextComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.Value) {
      return DashboardValueComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.Table) {
      return DashboardTableComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.Gauge) {
      return DashboardGaugeComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.LogStream) {
      return DashboardLogStreamComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.TraceList) {
      return DashboardTraceListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.AlertList) {
      return DashboardAlertListComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.MonitorStatus) {
      return DashboardMonitorStatusComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    if (dashboardComponentType === DashboardComponentType.Embed) {
      return DashboardEmbedComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    throw new BadDataException(
      `Unknown dashboard component type: ${dashboardComponentType}`,
    );
  }
}
