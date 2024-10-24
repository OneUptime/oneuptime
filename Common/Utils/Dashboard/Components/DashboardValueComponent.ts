import { ObjectType } from "../../../Types/JSON";
import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";

export default class DashboardViewConfigUtil {
  public static createDefaultDashboardViewConfig(): DashboardViewConfig {
    return {
      _type: ObjectType.DashboardValueComponent,
      components: [],
    };
  }

  public static addDefaultChartComponent(): DashboardViewConfig {

  }
}
