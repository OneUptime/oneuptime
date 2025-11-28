import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import BadDataException from "../../../Types/Exception/BadDataException";
import DashboardChartComponentUtil from "./DashboardChartComponent";
import DashboardTextComponentUtil from "./DashboardTextComponent";
import DashboardValueComponentUtil from "./DashboardValueComponent";
import DashboardLogsComponentUtil from "./DashboardLogsComponent";

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

    if (dashboardComponentType === DashboardComponentType.Logs) {
      return DashboardLogsComponentUtil.getComponentConfigArguments() as Array<
        ComponentArgument<DashboardBaseComponent>
      >;
    }

    throw new BadDataException(
      `Unknown dashboard component type: ${dashboardComponentType}`,
    );
  }
}
